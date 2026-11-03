"""Meta Model API client for MetaFabricAI (Step 9).

Verified against the official Meta developer documentation
(https://dev.meta.ai/docs/models and /docs/protocols/chat-completions):

- Base URL ``https://api.meta.ai/v1``, OpenAI-compatible Chat Completions.
- Default model ``muse-spark-1.3``; optional reasoning model
  ``muse-wonder-1.0`` (reserved for complex reasoning / Step 10).
- Auth is a Bearer [REDACTED] supplied via ``MODEL_API_KEY`` (server-side only).
- Structured output uses strict JSON Schema mode:
  ``response_format={"type": "json_schema", "json_schema": {"name": ...,
  "strict": True, "schema": ...}}``. The caller-supplied schema is first
  normalized to the strict subset (see :func:`to_strict_json_schema`) and
  the parsed result is still validated with the caller's Pydantic model.

Root cause of the former HTTP 502 "Model response did not contain a JSON
object": the schema was sent without ``strict`` and without
``additionalProperties: false`` / ``required``, so Muse Spark invented an
unbounded series of extra properties until the completion budget
(reasoning tokens included) was exhausted (``finish_reason="length"``),
leaving unterminated JSON with no closing brace.

Diagnostics never log API keys, prompts, catalog text, reasoning content,
or raw model responses -- only sizes, counts, finish reasons, and usage.
"""

from __future__ import annotations

import json
import logging
import re
import time
from typing import Any

from app.config import get_settings

logger = logging.getLogger(__name__)

_PLACEHOLDER_KEYS = {"", "your_actual_meta_model_api_key", "your_api_key"}
_ALLOWED_REASONING_EFFORTS = {"low", "medium", "high"}
_MAX_TOKEN_RETRY_BUDGET = 16384


class ModelClientError(Exception):
    """Base error for Meta Model API failures."""


class ModelConfigurationError(ModelClientError):
    """Raised when the Meta Model API is not configured (missing key)."""


class ModelProviderError(ModelClientError):
    """Raised for provider errors, timeouts, and rate limits."""


class ModelResponseError(ModelClientError):
    """Raised when the model response is malformed or fails validation."""


def to_strict_json_schema(schema: dict[str, Any]) -> dict[str, Any]:
    """Normalize a Pydantic JSON Schema to the strict structured-output subset.

    Resolves local ``$defs``/``$ref``, drops annotation-only keys
    (``title``/``description``/``default``) and numeric bounds (enforced by
    Pydantic after parsing), and forces every object to declare
    ``additionalProperties: false`` with all properties ``required`` so the
    provider cannot invent extra properties.
    """
    defs = schema.get("$defs") or {}

    def convert(node: Any) -> Any:
        if not isinstance(node, dict):
            return node
        ref = node.get("$ref")
        if isinstance(ref, str) and ref.startswith("#/$defs/"):
            target = defs.get(ref.removeprefix("#/$defs/"))
            if isinstance(target, dict):
                return convert(target)
        out: dict[str, Any] = {}
        for key, value in node.items():
            if key in ("$defs", "title", "description", "default"):
                continue
            if key in ("minimum", "maximum", "exclusiveMinimum",
                       "exclusiveMaximum", "minLength", "maxLength"):
                continue
            if key == "properties" and isinstance(value, dict):
                out[key] = {k: convert(v) for k, v in value.items()}
            elif key == "items":
                out[key] = convert(value)
            elif key == "anyOf" and isinstance(value, list):
                out[key] = [convert(v) for v in value]
            elif key in ("type", "enum", "format"):
                out[key] = value
        if out.get("type") == "object" and "properties" in out:
            out["additionalProperties"] = False
            out["required"] = list(out["properties"].keys())
        return out

    converted = convert(schema)
    return converted if isinstance(converted, dict) else {"type": "object"}


def extract_json_object(text: str) -> dict[str, Any]:
    """Extract a JSON object from free-form text (unstructured fallback only).

    Used solely after the provider rejects structured output; the primary
    structured path parses ``message.content`` directly with ``json.loads``.
    """
    if not isinstance(text, str) or not text.strip():
        raise ModelResponseError("Model returned an empty response.")
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
        cleaned = re.sub(r"\s*```$", "", cleaned).strip()
    try:
        parsed = json.loads(cleaned)
    except (json.JSONDecodeError, ValueError):
        start, end = cleaned.find("{"), cleaned.rfind("}")
        if start < 0 or end <= start:
            raise ModelResponseError(
                "Model response did not contain a JSON object."
            ) from None
        try:
            parsed = json.loads(cleaned[start : end + 1])
        except (json.JSONDecodeError, ValueError):
            raise ModelResponseError(
                "Model response contained malformed JSON."
            ) from None
    if not isinstance(parsed, dict):
        raise ModelResponseError("Model response JSON was not an object.")
    return parsed


def _get(obj: Any, key: str) -> Any:
    if isinstance(obj, dict):
        return obj.get(key)
    return getattr(obj, key, None)


def _inspect_response(response: Any) -> dict[str, Any]:
    """Collect safe diagnostics from a Chat Completions response."""
    usage = _get(response, "usage")
    details = _get(usage, "completion_tokens_details") if usage else None
    info: dict[str, Any] = {
        "request_id": _get(response, "id"),
        "choices": 0,
        "finish_reason": None,
        "content_state": "missing",
        "content_length": 0,
        "content": None,
        "refusal": None,
        "prompt_tokens": _get(usage, "prompt_tokens") if usage else None,
        "completion_tokens": (
            _get(usage, "completion_tokens") if usage else None
        ),
        "total_tokens": _get(usage, "total_tokens") if usage else None,
        "reasoning_tokens": _get(details, "reasoning_tokens") if details else None,
    }
    choices = _get(response, "choices") or []
    info["choices"] = len(choices)
    if not choices:
        return info
    choice = choices[0]
    info["finish_reason"] = _get(choice, "finish_reason")
    message = _get(choice, "message")
    content = _get(message, "content") if message is not None else None
    info["refusal"] = _get(message, "refusal") if message is not None else None
    if content is None:
        info["content_state"] = "null"
    elif not isinstance(content, str):
        info["content_state"] = "non_string"
    elif not content.strip():
        info["content_state"] = "empty"
    else:
        info["content_state"] = "populated"
        info["content_length"] = len(content)
        info["content"] = content
    return info


def _log_response(operation: str, model: str, info: dict[str, Any]) -> None:
    logger.info(
        "model response operation=%s model=%s request_id=%s choices=%s "
        "finish_reason=%s content=%s content_length=%s prompt_tokens=%s "
        "completion_tokens=%s reasoning_tokens=%s total_tokens=%s",
        operation, model, info["request_id"], info["choices"],
        info["finish_reason"], info["content_state"], info["content_length"],
        info["prompt_tokens"], info["completion_tokens"],
        info["reasoning_tokens"], info["total_tokens"],
    )


def _provider_error(exc: Exception) -> ModelProviderError:
    name = type(exc).__name__
    status = getattr(exc, "status_code", None) or getattr(exc, "status", None)
    detail = str(exc)[:300]
    if "Timeout" in name or isinstance(exc, TimeoutError):
        return ModelProviderError(f"Meta Model API request timed out: {detail}")
    if status == 429:
        return ModelProviderError(f"Meta Model API rate limit exceeded: {detail}")
    if isinstance(status, int):
        return ModelProviderError(
            f"Meta Model API request failed (HTTP {status}): {detail}"
        )
    return ModelProviderError(f"Meta Model API request failed ({name}): {detail}")


class MetaModelClient:
    """Async OpenAI-compatible client for the Meta Model API."""

    def __init__(
        self,
        api_key: str | None = None,
        model: str | None = None,
        reasoning_model: str | None = None,
        base_url: str | None = None,
        timeout_seconds: float | None = None,
        max_retries: int | None = None,
        reasoning_effort: str | None = None,
        client: Any | None = None,
    ) -> None:
        settings = get_settings()
        key = api_key if api_key is not None else settings.model_api_key
        self.api_key = key.strip() if isinstance(key, str) else None
        self.model = model or settings.meta_model
        self.reasoning_model = reasoning_model or settings.meta_reasoning_model
        self.base_url = (base_url or settings.meta_api_base_url).rstrip("/")
        self.timeout_seconds = (
            timeout_seconds
            if timeout_seconds is not None
            else settings.model_timeout_seconds
        )
        self.max_retries = (
            max_retries if max_retries is not None else settings.model_max_retries
        )
        effort = (
            reasoning_effort
            if reasoning_effort is not None
            else settings.model_reasoning_effort
        )
        if effort is not None and effort not in _ALLOWED_REASONING_EFFORTS:
            logger.warning(
                "ignoring unsupported reasoning_effort=%r (allowed: %s)",
                effort, sorted(_ALLOWED_REASONING_EFFORTS),
            )
            effort = None
        self.reasoning_effort = effort
        self._client = client
        # Last successful Chat Completions usage, for Step 12 latency /
        # token accounting. Updated after every successful generate_json
        # call; None when the provider did not report usage (or when a
        # test double bypasses this client entirely).
        self.last_usage: dict[str, Any] | None = None
        # Cumulative usage across all generate_json calls on this client,
        # so multi-call searches (parallel batches + final rank) can sum
        # actual model input/output/reasoning tokens.
        self.usage_totals: dict[str, float] = {
            "prompt_tokens": 0.0,
            "completion_tokens": 0.0,
            "total_tokens": 0.0,
            "reasoning_tokens": 0.0,
        }
        # Per-attempt execution history for Step 12.1 latency accounting.
        # One entry per Chat Completions call (success or provider error),
        # grouped by generate_json invocation via ``call_id`` so parallel
        # batches stay attributable. Records model, budgets, wall time,
        # provider-reported usage, and finish reason -- never prompts,
        # catalog text, or raw responses.
        self.call_history: list[dict[str, Any]] = []
        self._call_seq = 0

    @property
    def is_configured(self) -> bool:
        return bool(self.api_key) and self.api_key not in _PLACEHOLDER_KEYS

    def ensure_configured(self) -> None:
        if not self.is_configured:
            raise ModelConfigurationError(
                "MODEL_API_KEY is not configured. Set a valid Meta Model API "
                "key in backend/.env (see backend/.env.example)."
            )

    def _get_client(self) -> Any:
        if self._client is not None:
            return self._client
        self.ensure_configured()
        from openai import AsyncOpenAI

        self._client = AsyncOpenAI(
            api_key=self.api_key,
            base_url=self.base_url,
            timeout=self.timeout_seconds,
            max_retries=self.max_retries,
        )
        return self._client

    def model_for(self, use_reasoning: bool = False) -> str:
        return self.reasoning_model if use_reasoning else self.model

    async def generate_json(
        self,
        *,
        system_prompt: str,
        user_prompt: str,
        schema_name: str,
        json_schema: dict[str, Any],
        use_reasoning: bool = False,
        max_completion_tokens: int = 4096,
    ) -> dict[str, Any]:
        """Return a JSON object from a strict structured-output call.

        Primary path: strict ``json_schema`` response format with a
        normalized schema; content is parsed directly with ``json.loads``.
        If the provider rejects ``response_format`` with HTTP 400, exactly
        one logged fallback retries without it and extracts JSON from the
        text. A response truncated by the token budget
        (``finish_reason="length"``) is retried exactly once with a doubled
        budget capped at ``_MAX_TOKEN_RETRY_BUDGET``. All other failures
        raise controlled :class:`ModelProviderError` /
        :class:`ModelResponseError` without fabricating data.
        """
        self.ensure_configured()
        client = self._get_client()
        messages = [
            {"role": "developer", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ]
        model = self.model_for(use_reasoning)
        self._call_seq += 1
        call_id = self._call_seq
        strict_format: dict[str, Any] | None = {
            "type": "json_schema",
            "json_schema": {
                "name": schema_name,
                "strict": True,
                "schema": to_strict_json_schema(json_schema),
            },
        }
        last_error: Exception | None = None
        for response_format in (strict_format, None):
            budget = max_completion_tokens
            for token_attempt in range(2):
                kwargs: dict[str, Any] = {
                    "model": model,
                    "messages": messages,
                    "max_completion_tokens": budget,
                }
                if response_format is not None:
                    kwargs["response_format"] = response_format
                if self.reasoning_effort is not None:
                    kwargs["reasoning_effort"] = self.reasoning_effort
                logger.info(
                    "model request operation=%s model=%s "
                    "max_completion_tokens=%s reasoning_effort=%s structured=%s",
                    schema_name, model, budget, self.reasoning_effort,
                    response_format is not None,
                )
                attempt_started = time.perf_counter()
                try:
                    response = await client.chat.completions.create(**kwargs)
                except ModelClientError:
                    raise
                except Exception as exc:  # provider / timeout / connection
                    self.call_history.append({
                        "call_id": call_id,
                        "operation": schema_name,
                        "model": model,
                        "max_completion_tokens": budget,
                        "reasoning_effort": self.reasoning_effort,
                        "structured": response_format is not None,
                        "wall_ms": round(
                            (time.perf_counter() - attempt_started) * 1000, 1
                        ),
                        "finish_reason": None,
                        "prompt_tokens": None,
                        "completion_tokens": None,
                        "total_tokens": None,
                        "reasoning_tokens": None,
                        "content_state": None,
                        "content_length": 0,
                        "parse_ms": 0.0,
                        "error": f"{type(exc).__name__}: {str(exc)[:120]}",
                    })
                    last_error = exc
                    status = getattr(exc, "status_code", None) or getattr(
                        exc, "status", None
                    )
                    if (response_format is not None and status == 400
                            and token_attempt == 0):
                        logger.warning(
                            "model structured output rejected operation=%s "
                            "model=%s error_type=%s status=%s; retrying once "
                            "without response_format",
                            schema_name, model, type(exc).__name__, status,
                        )
                        break  # one controlled fallback, never silent
                    raise _provider_error(exc) from exc
                info = _inspect_response(response)
                _log_response(schema_name, model, info)
                self.call_history.append({
                    "call_id": call_id,
                    "operation": schema_name,
                    "model": model,
                    "max_completion_tokens": budget,
                    "reasoning_effort": self.reasoning_effort,
                    "structured": response_format is not None,
                    "wall_ms": round(
                        (time.perf_counter() - attempt_started) * 1000, 1
                    ),
                    "finish_reason": info.get("finish_reason"),
                    "prompt_tokens": info.get("prompt_tokens"),
                    "completion_tokens": info.get("completion_tokens"),
                    "total_tokens": info.get("total_tokens"),
                    "reasoning_tokens": info.get("reasoning_tokens"),
                    "content_state": info.get("content_state"),
                    "content_length": info.get("content_length"),
                    "parse_ms": 0.0,
                    "error": None,
                })
                self.last_usage = {
                    "prompt_tokens": info.get("prompt_tokens"),
                    "completion_tokens": info.get("completion_tokens"),
                    "total_tokens": info.get("total_tokens"),
                    "reasoning_tokens": info.get("reasoning_tokens"),
                }
                for key in self.usage_totals:
                    value = self.last_usage.get(key)
                    if isinstance(value, (int, float)):
                        self.usage_totals[key] += float(value)
                if info["choices"] == 0:
                    raise ModelResponseError(
                        "Model response contained no choices."
                    )
                if info["refusal"]:
                    raise ModelResponseError(
                        f"Model refused the request for operation "
                        f"'{schema_name}' (finish_reason="
                        f"{info['finish_reason']!r})."
                    )
                if info["finish_reason"] == "length":
                    if token_attempt == 0 and budget < _MAX_TOKEN_RETRY_BUDGET:
                        budget = min(budget * 2, _MAX_TOKEN_RETRY_BUDGET)
                        logger.warning(
                            "model response truncated operation=%s model=%s "
                            "completion_tokens=%s reasoning_tokens=%s; "
                            "retrying once with max_completion_tokens=%s",
                            schema_name, model, info["completion_tokens"],
                            info["reasoning_tokens"], budget,
                        )
                        continue
                    raise ModelResponseError(
                        f"Model response was truncated for operation "
                        f"'{schema_name}' (finish_reason='length', "
                        f"completion_tokens={info['completion_tokens']}, "
                        f"reasoning_tokens={info['reasoning_tokens']}). "
                        f"Increase the operation token budget."
                    )
                if info["content_state"] != "populated":
                    raise ModelResponseError(
                        f"Model response contained empty content for "
                        f"operation '{schema_name}' (content="
                        f"{info['content_state']}, finish_reason="
                        f"{info['finish_reason']!r})."
                    )
                content = info["content"]
                parse_started = time.perf_counter()
                try:
                    if response_format is not None:
                        text = content.strip()
                        if text.startswith("```"):
                            text = re.sub(r"^```(?:json)?\s*", "", text)
                            text = re.sub(r"\s*```$", "", text).strip()
                        parsed = json.loads(text)
                        if not isinstance(parsed, dict):
                            raise ModelResponseError(
                                "Model response JSON was not an object."
                            )
                    else:
                        parsed = extract_json_object(content)
                except ModelResponseError:
                    logger.warning(
                        "model parse failed operation=%s model=%s "
                        "error_type=ModelResponseError structured=%s",
                        schema_name, model, response_format is not None,
                    )
                    raise
                except (json.JSONDecodeError, ValueError) as exc:
                    logger.warning(
                        "model parse failed operation=%s model=%s "
                        "error_type=%s structured=%s",
                        schema_name, model, type(exc).__name__,
                        response_format is not None,
                    )
                    raise ModelResponseError(
                        "Model response contained malformed JSON."
                    ) from exc
                logger.info(
                    "model parse succeeded operation=%s model=%s",
                    schema_name, model,
                )
                parse_ms = (time.perf_counter() - parse_started) * 1000
                for entry in reversed(self.call_history):
                    if entry.get("call_id") == call_id:
                        entry["parse_ms"] = round(
                            entry.get("parse_ms", 0.0) + parse_ms, 1
                        )
                        break
                return parsed
        raise _provider_error(last_error) if last_error else ModelProviderError(
            "Meta Model API request failed."
        )
