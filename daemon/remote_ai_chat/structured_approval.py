"""Validate user input before resolving a provider's pending request."""
from __future__ import annotations

import json
from urllib.parse import urlparse

from jsonschema import Draft202012Validator, FormatChecker
from jsonschema.exceptions import SchemaError, ValidationError

from .errors import Err


def invalid(message: str) -> Err:
    return Err("invalid_approval_response", message)


def check_request(request: dict) -> None:
    """Only advertise fields the Divan form can actually render safely."""
    kind = request.get("kind")
    if kind == "user_input":
        questions = request.get("questions")
        if not isinstance(questions, list) or not 1 <= len(questions) <= 3:
            raise invalid("The tool requested an unsupported question form; use its native client.")
        ids = set()
        for q in questions:
            if not isinstance(q, dict) or not isinstance(q.get("id"), str) or not q["id"] or q["id"] in ids:
                raise invalid("The tool requested invalid question identifiers.")
            ids.add(q["id"])
            if not isinstance(q.get("question"), str):
                raise invalid("The tool requested an invalid question.")
            options = q.get("options") or []
            if not isinstance(options, list) or any(not isinstance(o, dict) or not isinstance(o.get("label"), str) for o in options):
                raise invalid("The tool requested unsupported question options.")
        return
    if kind != "mcp_elicitation":
        return
    mode = request.get("mode", "form")
    if mode == "url":
        url = request.get("url")
        if not isinstance(url, str) or urlparse(url).scheme not in ("http", "https") or not urlparse(url).netloc:
            raise invalid("The tool requested an unsupported confirmation URL.")
        return
    if mode != "form":
        raise invalid(f"Divan does not support MCP form mode {mode!r}; use the tool's native client.")
    schema = request.get("requestedSchema")
    if not isinstance(schema, dict) or schema.get("type") != "object" or not isinstance(schema.get("properties"), dict):
        raise invalid("The tool requested an unsupported form schema; use its native client.")
    root_keys = {"type", "properties", "required", "additionalProperties", "title", "description", "$schema"}
    field_keys = {"type", "title", "description", "default", "enum", "enumNames", "oneOf", "minLength", "maxLength", "pattern", "format", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "items", "minItems", "maxItems", "uniqueItems", "writeOnly"}
    if set(schema) - root_keys or schema.get("additionalProperties") not in (None, False, True):
        raise invalid("The tool requested unsupported form constraints; use its native client.")
    for field in schema["properties"].values():
        if not isinstance(field, dict) or set(field) - field_keys or field.get("type") not in ("string", "number", "integer", "boolean", "array"):
            raise invalid("The tool requested an unsupported field; use its native client.")
        if "oneOf" in field and (not isinstance(field["oneOf"], list) or any(not isinstance(o, dict) or "const" not in o or set(o) - {"const", "title"} for o in field["oneOf"])):
            raise invalid("The tool requested unsupported choice fields.")
        if field["type"] == "array":
            item = field.get("items")
            if not isinstance(item, dict) or item.get("type") != "string" or not isinstance(item.get("enum"), list) or set(item) - {"type", "enum", "enumNames"}:
                raise invalid("Divan supports only a list of named choices for array fields.")
    try:
        Draft202012Validator.check_schema(schema)
    except SchemaError:
        raise invalid("The tool requested an invalid form schema.") from None


def validate_response(request: dict, decision: str, response: object) -> dict:
    """Return an ephemeral payload. Never include supplied values in errors."""
    if decision not in ("allow", "deny", "cancel"):
        raise invalid("Choose Allow, Decline, or Cancel for this request.")
    if decision != "allow":
        return {"decision": decision}
    check_request(request)
    if response is None:
        response = {}
    if not isinstance(response, dict):
        raise invalid("The response must be an object.")
    try:
        if len(json.dumps(response)) > 65536:
            raise invalid("The response is too large.")
    except (TypeError, ValueError):
        raise invalid("The response must contain JSON values.") from None
    if request["kind"] == "mcp_elicitation":
        content = response.get("content")
        if request.get("mode", "form") == "url":
            if content is not None:
                raise invalid("URL confirmation does not accept form values.")
        else:
            if not isinstance(content, dict):
                raise invalid("Complete the requested form before allowing it.")
            schema = request["requestedSchema"]
            if set(content) - set(schema["properties"]):
                raise invalid("The response contains fields the tool did not request.")
            try:
                Draft202012Validator(schema, format_checker=FormatChecker()).validate(content)
            except ValidationError:
                raise invalid("Complete all required fields using the requested types and constraints.") from None
        return {"decision": decision, "response": {"content": content}}
    answers = response.get("answers")
    questions = request["questions"]
    if not isinstance(answers, dict) or set(answers) != {q["id"] for q in questions}:
        raise invalid("Answer each requested question before continuing.")
    for q in questions:
        value = answers[q["id"]]
        if not isinstance(value, dict) or set(value) != {"answers"} or not isinstance(value["answers"], list) or len(value["answers"]) != 1 or not isinstance(value["answers"][0], str) or not value["answers"][0].strip():
            raise invalid("Choose or enter one answer for each question.")
        choices = [o["label"] for o in q.get("options") or []]
        if choices and not q.get("isOther") and value["answers"][0] not in choices:
            raise invalid("Choose one of the offered answers.")
    return {"decision": decision, "response": {"answers": answers}}
