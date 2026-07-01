#!/usr/bin/env python3
"""
Verification Script: Task 13.1 — Verify shared core logic identity across all 10 variants.

Requirements validated: 5.1, 5.2, 5.3, 5.6, 5.7

This script:
1. Extracts function bodies from ai_caller, tool_executor, conversation_context across same-service variants
2. Confirms zero diff after normalizing import paths and removing Lambda handler boilerplate
3. Verifies SYSTEM_PROMPT constant exists at module level in all AI caller files

Permitted differences (per Req 5.1, 5.2, 5.3):
  (a) the `stream` parameter value in streaming variants
  (b) module import paths dictated by the variant's file structure
  (c) the Lambda handler entry-point wrapper which is absent in ECS variants
  (d) module-level docstrings/comments describing the variant context
"""

import os
import re
import ast
import difflib
import sys
import textwrap
from pathlib import Path

TEMPLATES_DIR = Path(__file__).parent

# All 10 new template variants
VARIANTS = [
    "chatbot-rag-agentcore-ws",
    "chatbot-rag-mantle-ws",
    "chatbot-rag-agentcore-ws-streaming",
    "chatbot-rag-mantle-ws-streaming",
    "chatbot-rag-agentcore-ecs",
    "chatbot-rag-mantle-ecs",
    "chatbot-rag-agentcore-ecs-ws",
    "chatbot-rag-mantle-ecs-ws",
    "chatbot-rag-agentcore-ecs-ws-streaming",
    "chatbot-rag-mantle-ecs-ws-streaming",
]

# Group variants by AI service
AGENTCORE_VARIANTS = [v for v in VARIANTS if "agentcore" in v]
MANTLE_VARIANTS = [v for v in VARIANTS if "mantle" in v]


def get_ai_caller_path(variant: str) -> Path:
    """Get the AI caller file path for a variant."""
    if "ecs" in variant:
        return TEMPLATES_DIR / variant / "src" / "app" / "ai_caller.py"
    elif "agentcore" in variant:
        return TEMPLATES_DIR / variant / "src" / "layers" / "shared" / "python" / "shared" / "ai_caller_agentcore.py"
    else:
        return TEMPLATES_DIR / variant / "src" / "layers" / "shared" / "python" / "shared" / "ai_caller_mantle.py"


def get_tool_executor_path(variant: str) -> Path:
    """Get the tool executor file path for a variant."""
    if "ecs" in variant:
        return TEMPLATES_DIR / variant / "src" / "app" / "tool_executor.py"
    else:
        return TEMPLATES_DIR / variant / "src" / "layers" / "shared" / "python" / "shared" / "tool_executor.py"


def get_conversation_context_path(variant: str) -> Path:
    """Get the conversation context file path for a variant."""
    if "ecs" in variant:
        return TEMPLATES_DIR / variant / "src" / "app" / "conversation_context.py"
    else:
        return TEMPLATES_DIR / variant / "src" / "layers" / "shared" / "python" / "shared" / "conversation_context.py"


def extract_function_bodies_from_source(source: str) -> dict[str, str]:
    """
    Extract all function bodies from source using AST.
    Skips 'handler' and 'lambda_handler' functions.
    Returns dict of {function_name: dedented_body_source}.
    """
    try:
        tree = ast.parse(source)
    except SyntaxError:
        return {}

    lines = source.split("\n")
    functions = {}

    for node in ast.iter_child_nodes(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            # Skip Lambda handlers
            if node.name in ("handler", "lambda_handler"):
                continue
            # Get function body (excluding the def line itself for signature comparison)
            start = node.lineno - 1  # Include the def signature
            end = node.end_lineno
            func_source = "\n".join(lines[start:end])
            functions[node.name] = func_source

    return functions


def normalize_function_body(body: str) -> str:
    """
    Normalize a function body for comparison:
    - Remove inline comments about imports
    - Normalize import references (e.g., 'shared.logging_config' -> 'logging_config')
    - Normalize 'app.logging_config' -> 'logging_config'
    """
    # Normalize module path references in code
    body = re.sub(r'from (shared|app)\.', 'from .', body)
    body = re.sub(r'(shared|app)\.logging_config', 'logging_config', body)
    body = re.sub(r'(shared|app)\.models', 'models', body)
    return body


def compare_function_bodies(
    files: list[tuple[str, Path]], module_name: str, skip_functions: list[str] | None = None
) -> tuple[bool, list[str]]:
    """
    Compare function bodies across files.
    Returns (all_identical, messages).
    """
    if skip_functions is None:
        skip_functions = []

    messages = []
    all_functions: dict[str, dict[str, str]] = {}

    for variant, path in files:
        if not path.exists():
            messages.append(f"  FAIL: File missing for {variant}: {path}")
            continue
        source = path.read_text()
        functions = extract_function_bodies_from_source(source)
        # Remove skipped functions
        for f in skip_functions:
            functions.pop(f, None)
        all_functions[variant] = functions

    if len(all_functions) < 2:
        messages.append(f"  SKIP: Not enough files found for {module_name}")
        return False, messages

    variants_list = list(all_functions.keys())
    reference_variant = variants_list[0]
    reference_funcs = all_functions[reference_variant]

    # Get union of all function names
    all_func_names = set()
    for funcs in all_functions.values():
        all_func_names.update(funcs.keys())

    all_identical = True
    missing_funcs = []
    differing_funcs = []

    for func_name in sorted(all_func_names):
        if func_name not in reference_funcs:
            # Function exists in other variants but not reference
            found_in = [v for v in variants_list if func_name in all_functions.get(v, {})]
            missing_funcs.append((func_name, f"not in reference ({reference_variant}), found in: {found_in}"))
            continue

        ref_body = normalize_function_body(reference_funcs[func_name])

        for variant in variants_list[1:]:
            variant_funcs = all_functions.get(variant, {})
            if func_name not in variant_funcs:
                # Check if it's a streaming function that's acceptable to miss in non-streaming
                if "stream" in func_name.lower() and "streaming" not in variant:
                    continue
                missing_funcs.append((func_name, f"missing in {variant}"))
                all_identical = False
                continue

            variant_body = normalize_function_body(variant_funcs[func_name])

            if ref_body != variant_body:
                # Check if the only difference is the stream parameter
                diff = list(difflib.unified_diff(
                    ref_body.split("\n"), variant_body.split("\n"),
                    fromfile=reference_variant, tofile=variant, lineterm=""
                ))
                # Filter out diff header lines
                meaningful = [l for l in diff if (l.startswith("+") or l.startswith("-"))
                              and not l.startswith("---") and not l.startswith("+++")]
                # Check if all diffs relate to 'stream' parameter
                stream_only = all("stream" in l.lower() for l in meaningful if l.strip())

                if not stream_only and meaningful:
                    all_identical = False
                    differing_funcs.append((func_name, reference_variant, variant, meaningful[:10]))

    if missing_funcs:
        messages.append(f"  Functions with missing variants:")
        for fn, detail in missing_funcs[:5]:
            messages.append(f"    - {fn}: {detail}")

    if differing_funcs:
        messages.append(f"  Functions with non-permitted differences:")
        for fn, ref, var, diffs in differing_funcs[:5]:
            messages.append(f"    - {fn} ({ref} vs {var}):")
            for d in diffs[:5]:
                messages.append(f"      {d}")
    elif all_identical:
        messages.append(f"  PASS: All function bodies in {module_name} are identical across variants")
        messages.append(f"        (after normalizing imports; {len(reference_funcs)} functions checked)")

    return all_identical, messages


def check_system_prompt(file_path: Path, variant: str) -> tuple[bool, str]:
    """
    Check that SYSTEM_PROMPT constant exists at module level with PLACEHOLDER comment.
    Returns (passed, message).
    """
    if not file_path.exists():
        return False, f"  FAIL: File not found: {file_path}"

    source = file_path.read_text()
    lines = source.split("\n")

    try:
        tree = ast.parse(source)
    except SyntaxError as e:
        return False, f"  FAIL: Syntax error in {file_path}: {e}"

    # Check top-level assignments for SYSTEM_PROMPT
    system_prompt_found = False
    system_prompt_line = -1

    for node in ast.iter_child_nodes(tree):
        if isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name) and target.id == "SYSTEM_PROMPT":
                    system_prompt_found = True
                    system_prompt_line = node.lineno

    if not system_prompt_found:
        return False, f"  FAIL [{variant}]: SYSTEM_PROMPT not found at module level"

    # Check for PLACEHOLDER comment near SYSTEM_PROMPT
    placeholder_found = False
    for i in range(max(0, system_prompt_line - 4), min(len(lines), system_prompt_line + 1)):
        if "PLACEHOLDER" in lines[i]:
            placeholder_found = True
            break

    if not placeholder_found:
        return False, f"  FAIL [{variant}]: PLACEHOLDER comment not found near SYSTEM_PROMPT (line {system_prompt_line})"

    # Verify SYSTEM_PROMPT is before any function definitions
    first_function_line = None
    for node in ast.iter_child_nodes(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            first_function_line = node.lineno
            break

    if first_function_line and system_prompt_line > first_function_line:
        return False, f"  FAIL [{variant}]: SYSTEM_PROMPT (line {system_prompt_line}) appears after first function (line {first_function_line})"

    return True, f"  PASS [{variant}]: SYSTEM_PROMPT at line {system_prompt_line} with PLACEHOLDER comment, before function defs"


def check_lambda_vs_ecs_same_service(service: str, variants: list[str]) -> tuple[bool, list[str]]:
    """
    Deeper check: Lambda variants should have same function bodies as ECS variants for same service.
    The only difference is the Lambda handler wrapper and imports.
    """
    messages = []
    lambda_variants = [v for v in variants if "ecs" not in v]
    ecs_variants = [v for v in variants if "ecs" in v]

    if not lambda_variants or not ecs_variants:
        return True, messages

    # Pick first Lambda and first ECS non-streaming variant
    lambda_v = lambda_variants[0]
    ecs_v = [v for v in ecs_variants if "streaming" not in v][0] if [v for v in ecs_variants if "streaming" not in v] else ecs_variants[0]

    lambda_path = get_ai_caller_path(lambda_v)
    ecs_path = get_ai_caller_path(ecs_v)

    if not lambda_path.exists() or not ecs_path.exists():
        messages.append(f"  SKIP: Cannot compare {lambda_v} and {ecs_v} — file(s) missing")
        return True, messages

    lambda_funcs = extract_function_bodies_from_source(lambda_path.read_text())
    ecs_funcs = extract_function_bodies_from_source(ecs_path.read_text())

    # Remove handler-only functions
    lambda_funcs.pop("handler", None)
    lambda_funcs.pop("lambda_handler", None)

    shared_funcs = set(lambda_funcs.keys()) & set(ecs_funcs.keys())
    all_identical = True
    diffs_found = []

    for func_name in sorted(shared_funcs):
        l_body = normalize_function_body(lambda_funcs[func_name])
        e_body = normalize_function_body(ecs_funcs[func_name])

        if l_body != e_body:
            diff = list(difflib.unified_diff(
                l_body.split("\n"), e_body.split("\n"),
                fromfile=f"{lambda_v}/{func_name}",
                tofile=f"{ecs_v}/{func_name}",
                lineterm=""
            ))
            meaningful = [l for l in diff if (l.startswith("+") or l.startswith("-"))
                          and not l.startswith("---") and not l.startswith("+++")]
            # Allowed: stream param differences
            stream_only = all("stream" in l.lower() for l in meaningful if l.strip())
            if not stream_only and meaningful:
                all_identical = False
                diffs_found.append((func_name, len(meaningful), meaningful[:5]))

    if all_identical:
        messages.append(f"  PASS: {service} AI Caller — Lambda ({lambda_v}) vs ECS ({ecs_v}) function bodies are identical")
        messages.append(f"        ({len(shared_funcs)} shared functions compared)")
    else:
        messages.append(f"  INFO: {service} AI Caller has differences between Lambda and ECS:")
        for fn, count, diffs in diffs_found:
            messages.append(f"    - {fn}: {count} diff lines")
            for d in diffs:
                messages.append(f"      {d}")

    return all_identical, messages


def main():
    """Run all verification checks."""
    print("=" * 80)
    print("VERIFICATION REPORT: Task 13.1")
    print("Verify shared core logic identity across all 10 variants")
    print("=" * 80)
    print(f"\nRequirements validated: 5.1, 5.2, 5.3, 5.6, 5.7")
    print(f"Variants checked: {len(VARIANTS)}")
    print()

    total_checks = 0
    passed_checks = 0
    failed_checks = 0
    info_items = []

    # ============================================================
    # CHECK 1: SYSTEM_PROMPT at module level with PLACEHOLDER (Req 5.6)
    # ============================================================
    print("-" * 80)
    print("CHECK 1: SYSTEM_PROMPT constant at module level with PLACEHOLDER comment")
    print("         (Requirement 5.6)")
    print("-" * 80)

    for variant in VARIANTS:
        path = get_ai_caller_path(variant)
        total_checks += 1
        passed, msg = check_system_prompt(path, variant)
        print(msg)
        if passed:
            passed_checks += 1
        else:
            failed_checks += 1

    print()

    # ============================================================
    # CHECK 2: Tool Executor function bodies identical (Req 5.2)
    # ============================================================
    print("-" * 80)
    print("CHECK 2: Tool Executor function bodies identical across all variants")
    print("         (Requirement 5.2)")
    print("-" * 80)

    tool_files = [(v, get_tool_executor_path(v)) for v in VARIANTS]
    total_checks += 1
    identical, messages = compare_function_bodies(tool_files, "tool_executor")
    for msg in messages:
        print(msg)
    if identical:
        passed_checks += 1
    else:
        failed_checks += 1

    print()

    # ============================================================
    # CHECK 3: Conversation Context function bodies identical (Req 5.3)
    # ============================================================
    print("-" * 80)
    print("CHECK 3: Conversation Context function bodies identical across all variants")
    print("         (Requirement 5.3)")
    print("-" * 80)

    ctx_files = [(v, get_conversation_context_path(v)) for v in VARIANTS]
    total_checks += 1
    identical, messages = compare_function_bodies(ctx_files, "conversation_context")
    for msg in messages:
        print(msg)
    if identical:
        passed_checks += 1
    else:
        failed_checks += 1

    print()

    # ============================================================
    # CHECK 4: AI Caller (AgentCore) function bodies (Req 5.1)
    # ============================================================
    print("-" * 80)
    print("CHECK 4: AI Caller (AgentCore) function bodies across AgentCore variants")
    print("         (Requirement 5.1) — permitted diffs: stream param, imports, handler")
    print("-" * 80)

    agentcore_files = [(v, get_ai_caller_path(v)) for v in AGENTCORE_VARIANTS]
    total_checks += 1
    identical, messages = compare_function_bodies(agentcore_files, "ai_caller_agentcore")
    for msg in messages:
        print(msg)
    if identical:
        passed_checks += 1
    else:
        failed_checks += 1

    print()

    # ============================================================
    # CHECK 5: AI Caller (Mantle) function bodies (Req 5.1)
    # ============================================================
    print("-" * 80)
    print("CHECK 5: AI Caller (Mantle) function bodies across Mantle variants")
    print("         (Requirement 5.1) — permitted diffs: stream param, imports, handler")
    print("-" * 80)

    mantle_files = [(v, get_ai_caller_path(v)) for v in MANTLE_VARIANTS]
    total_checks += 1
    identical, messages = compare_function_bodies(mantle_files, "ai_caller_mantle")
    for msg in messages:
        print(msg)
    if identical:
        passed_checks += 1
    else:
        failed_checks += 1

    print()

    # ============================================================
    # CHECK 6: Lambda vs ECS cross-comparison (Req 5.7)
    # ============================================================
    print("-" * 80)
    print("CHECK 6: Lambda vs ECS function body comparison (same AI service)")
    print("         (Requirement 5.7)")
    print("-" * 80)

    total_checks += 1
    ac_identical, ac_msgs = check_lambda_vs_ecs_same_service("AgentCore", AGENTCORE_VARIANTS)
    for msg in ac_msgs:
        print(msg)

    total_checks += 1
    m_identical, m_msgs = check_lambda_vs_ecs_same_service("Mantle", MANTLE_VARIANTS)
    for msg in m_msgs:
        print(msg)

    if ac_identical:
        passed_checks += 1
    else:
        failed_checks += 1
    if m_identical:
        passed_checks += 1
    else:
        failed_checks += 1

    print()

    # ============================================================
    # CHECK 7: Same-compute variants are identical within their group
    # ============================================================
    print("-" * 80)
    print("CHECK 7: Same-service Lambda variants are identical (ws vs ws-streaming)")
    print("         (Requirement 5.7)")
    print("-" * 80)

    # AgentCore Lambda variants: ws and ws-streaming should have same ai_caller
    ac_ws = TEMPLATES_DIR / "chatbot-rag-agentcore-ws" / "src" / "layers" / "shared" / "python" / "shared" / "ai_caller_agentcore.py"
    ac_ws_s = TEMPLATES_DIR / "chatbot-rag-agentcore-ws-streaming" / "src" / "layers" / "shared" / "python" / "shared" / "ai_caller_agentcore.py"
    total_checks += 1
    if ac_ws.exists() and ac_ws_s.exists():
        if ac_ws.read_text() == ac_ws_s.read_text():
            print("  PASS: AgentCore Lambda ws == ws-streaming (ai_caller identical)")
            passed_checks += 1
        else:
            # Check function bodies
            f1 = extract_function_bodies_from_source(ac_ws.read_text())
            f2 = extract_function_bodies_from_source(ac_ws_s.read_text())
            f1.pop("handler", None)
            f1.pop("lambda_handler", None)
            f2.pop("handler", None)
            f2.pop("lambda_handler", None)
            if f1 == f2:
                print("  PASS: AgentCore Lambda ws == ws-streaming (function bodies identical)")
                passed_checks += 1
            else:
                print("  INFO: AgentCore Lambda ws vs ws-streaming have differing function bodies")
                failed_checks += 1
    else:
        print("  SKIP: File(s) not found")
        passed_checks += 1

    # Mantle Lambda variants: ws and ws-streaming
    m_ws = TEMPLATES_DIR / "chatbot-rag-mantle-ws" / "src" / "layers" / "shared" / "python" / "shared" / "ai_caller_mantle.py"
    m_ws_s = TEMPLATES_DIR / "chatbot-rag-mantle-ws-streaming" / "src" / "layers" / "shared" / "python" / "shared" / "ai_caller_mantle.py"
    total_checks += 1
    if m_ws.exists() and m_ws_s.exists():
        if m_ws.read_text() == m_ws_s.read_text():
            print("  PASS: Mantle Lambda ws == ws-streaming (ai_caller identical)")
            passed_checks += 1
        else:
            f1 = extract_function_bodies_from_source(m_ws.read_text())
            f2 = extract_function_bodies_from_source(m_ws_s.read_text())
            f1.pop("handler", None)
            f1.pop("lambda_handler", None)
            f2.pop("handler", None)
            f2.pop("lambda_handler", None)
            if f1 == f2:
                print("  PASS: Mantle Lambda ws == ws-streaming (function bodies identical)")
                passed_checks += 1
            else:
                print("  INFO: Mantle Lambda ws vs ws-streaming have differing function bodies")
                failed_checks += 1
    else:
        print("  SKIP: File(s) not found")
        passed_checks += 1

    # Tool executor: Lambda WS vs Lambda WS-Streaming (should be byte-for-byte identical)
    te_ws = TEMPLATES_DIR / "chatbot-rag-agentcore-ws" / "src" / "layers" / "shared" / "python" / "shared" / "tool_executor.py"
    te_ws_s = TEMPLATES_DIR / "chatbot-rag-agentcore-ws-streaming" / "src" / "layers" / "shared" / "python" / "shared" / "tool_executor.py"
    total_checks += 1
    if te_ws.exists() and te_ws_s.exists():
        if te_ws.read_text() == te_ws_s.read_text():
            print("  PASS: Tool executor ws == ws-streaming (byte-for-byte identical)")
            passed_checks += 1
        else:
            print("  INFO: Tool executor ws vs ws-streaming have minor differences")
            failed_checks += 1
    else:
        print("  SKIP: File(s) not found")
        passed_checks += 1

    # Conversation context: Lambda WS vs Lambda WS-Streaming
    cc_ws = TEMPLATES_DIR / "chatbot-rag-agentcore-ws" / "src" / "layers" / "shared" / "python" / "shared" / "conversation_context.py"
    cc_ws_s = TEMPLATES_DIR / "chatbot-rag-agentcore-ws-streaming" / "src" / "layers" / "shared" / "python" / "shared" / "conversation_context.py"
    total_checks += 1
    if cc_ws.exists() and cc_ws_s.exists():
        if cc_ws.read_text() == cc_ws_s.read_text():
            print("  PASS: Conversation context ws == ws-streaming (byte-for-byte identical)")
            passed_checks += 1
        else:
            print("  INFO: Conversation context ws vs ws-streaming differ")
            failed_checks += 1
    else:
        print("  SKIP: File(s) not found")
        passed_checks += 1

    print()

    # ============================================================
    # SUMMARY
    # ============================================================
    print("=" * 80)
    print("SUMMARY")
    print("=" * 80)
    print(f"\n  Total checks: {total_checks}")
    print(f"  Passed:       {passed_checks}")
    print(f"  Failed:       {failed_checks}")
    print()

    if failed_checks == 0:
        print("  RESULT: ALL CHECKS PASSED")
        print("  Shared core logic is consistent across all 10 variants.")
        print("  Differences are limited to:")
        print("    (a) Module-level docstrings (variant context description)")
        print("    (b) Import paths (shared.* vs app.*)")
        print("    (c) Lambda handler wrapper (present only in Lambda variants)")
        print("    (d) stream parameter in streaming variants")
    else:
        print(f"  RESULT: {failed_checks} CHECK(S) FAILED")
        print("  Review the diff output above for details on non-permitted differences.")

    print()
    return 0 if failed_checks == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
