#!/usr/bin/env python3
"""
Validate template artifact structure completeness.

Checks all 10 new chatbot RAG template variants against requirements:
- Req 6.1: Lambda variants directory structure
- Req 6.2: ECS variants directory structure
- Req 6.5: .gitignore excludes all specified patterns
- Req 6.6: Makefile targets (build, deploy, test, lint, format + docker for ECS)
- Req 6.7: Reject artifacts missing mandatory files/dirs

Usage:
    python validate_structure.py
"""

import os
import sys
from pathlib import Path
from dataclasses import dataclass, field


TEMPLATES_DIR = Path(__file__).parent

# The 10 new template variants
LAMBDA_VARIANTS = [
    "chatbot-rag-agentcore-ws",
    "chatbot-rag-mantle-ws",
    "chatbot-rag-agentcore-ws-streaming",
    "chatbot-rag-mantle-ws-streaming",
]

ECS_VARIANTS = [
    "chatbot-rag-agentcore-ecs",
    "chatbot-rag-mantle-ecs",
    "chatbot-rag-agentcore-ecs-ws",
    "chatbot-rag-mantle-ecs-ws",
    "chatbot-rag-agentcore-ecs-ws-streaming",
    "chatbot-rag-mantle-ecs-ws-streaming",
]

ALL_VARIANTS = LAMBDA_VARIANTS + ECS_VARIANTS

# Required .gitignore patterns per Req 6.5
REQUIRED_GITIGNORE_PATTERNS = [
    "*.tfstate",       # Terraform state
    ".terraform/",     # Terraform cache
    "dist/",           # Build artifacts
    "build/",          # Build artifacts
    "__pycache__/",    # Python cache
    "*.pyc",           # Python compiled
    ".env",            # Environment files with secrets
    "*.tfvars",        # Terraform vars (secrets)
    "!*.tfvars.example",  # Exception for example files
    ".idea/",          # IDE files
    ".vscode/",        # IDE files
    ".DS_Store",       # OS files
]

# Lambda Makefile required targets per Req 6.6
LAMBDA_MAKEFILE_TARGETS = ["build", "deploy", "test", "lint", "format"]

# ECS Makefile required targets per Req 6.6
ECS_MAKEFILE_TARGETS = ["build", "deploy", "test", "lint", "format", "docker-build", "docker-push"]


@dataclass
class ValidationResult:
    """Result of a single validation check."""
    variant: str
    check: str
    passed: bool
    details: str = ""


@dataclass
class ValidationReport:
    """Full validation report."""
    results: list[ValidationResult] = field(default_factory=list)

    def add(self, variant: str, check: str, passed: bool, details: str = "") -> None:
        self.results.append(ValidationResult(variant, check, passed, details))

    @property
    def total(self) -> int:
        return len(self.results)

    @property
    def passed_count(self) -> int:
        return sum(1 for r in self.results if r.passed)

    @property
    def failed_count(self) -> int:
        return sum(1 for r in self.results if not r.passed)

    @property
    def all_passed(self) -> bool:
        return all(r.passed for r in self.results)


def check_path_exists(base: Path, relative: str) -> bool:
    """Check if a path (file or directory) exists relative to the base."""
    return (base / relative).exists()


def check_dir_exists(base: Path, relative: str) -> bool:
    """Check if a directory exists relative to the base."""
    return (base / relative).is_dir()


def check_file_exists(base: Path, relative: str) -> bool:
    """Check if a file exists relative to the base."""
    return (base / relative).is_file()


def validate_lambda_structure(variant: str, report: ValidationReport) -> None:
    """Validate Lambda variant directory structure per Req 6.1.

    Required structure:
    - src/ (with subdirectories per Lambda function and per shared layer)
    - infra/ (with environment/, modules/, openapi/)
    - tests/
    - docs/
    - build/
    - README.md
    - metadata.json
    - pyproject.toml
    - Makefile
    - .gitignore
    - uv.lock
    """
    base = TEMPLATES_DIR / variant

    # Top-level files
    required_files = [
        "README.md",
        "metadata.json",
        "pyproject.toml",
        "Makefile",
        ".gitignore",
        "uv.lock",
    ]
    for f in required_files:
        exists = check_file_exists(base, f)
        report.add(variant, f"File exists: {f}", exists,
                   "" if exists else f"Missing required file: {f}")

    # Top-level directories
    required_dirs = ["src", "infra", "tests", "docs", "build"]
    for d in required_dirs:
        exists = check_dir_exists(base, d)
        report.add(variant, f"Directory exists: {d}/", exists,
                   "" if exists else f"Missing required directory: {d}/")

    # src/ must have subdirectories (per Lambda function + shared layer)
    src_path = base / "src"
    if src_path.is_dir():
        subdirs = [d for d in src_path.iterdir() if d.is_dir()]
        has_subdirs = len(subdirs) > 0
        report.add(variant, "src/ has subdirectories", has_subdirs,
                   f"Found {len(subdirs)} subdirs" if has_subdirs else "src/ has no subdirectories")

        # Check for layers/shared subdirectory
        has_layers = check_dir_exists(base, "src/layers")
        report.add(variant, "src/layers/ exists (shared layer)", has_layers,
                   "" if has_layers else "Missing src/layers/ for shared layer")

    # infra/ must have environment/ and modules/
    infra_subdirs = ["infra/environment", "infra/modules"]
    for d in infra_subdirs:
        exists = check_dir_exists(base, d)
        report.add(variant, f"Directory exists: {d}/", exists,
                   "" if exists else f"Missing required directory: {d}/")

    # infra/environment/ must have dev/, staging/, prod/
    env_dirs = ["infra/environment/dev", "infra/environment/staging", "infra/environment/prod"]
    for d in env_dirs:
        exists = check_dir_exists(base, d)
        report.add(variant, f"Directory exists: {d}/", exists,
                   "" if exists else f"Missing required directory: {d}/")

    # infra/environment/dev/ must have specific files per Req 6.3
    env_files = [
        "infra/environment/dev/main.tf",
        "infra/environment/dev/variables.tf",
        "infra/environment/dev/outputs.tf",
        "infra/environment/dev/backend.tf",
        "infra/environment/dev/terraform.tfvars.example",
    ]
    for f in env_files:
        exists = check_file_exists(base, f)
        report.add(variant, f"File exists: {f}", exists,
                   "" if exists else f"Missing required file: {f}")


def validate_ecs_structure(variant: str, report: ValidationReport) -> None:
    """Validate ECS variant directory structure per Req 6.2.

    Required structure:
    - src/app/ (single application directory with Python modules)
    - infra/ (with environment/, modules/)
    - tests/
    - docs/
    - build/
    - Dockerfile (at template root)
    - README.md
    - metadata.json
    - pyproject.toml
    - Makefile
    - .gitignore
    - uv.lock
    """
    base = TEMPLATES_DIR / variant

    # Top-level files (includes Dockerfile for ECS)
    required_files = [
        "README.md",
        "metadata.json",
        "pyproject.toml",
        "Makefile",
        ".gitignore",
        "Dockerfile",
        "uv.lock",
    ]
    for f in required_files:
        exists = check_file_exists(base, f)
        report.add(variant, f"File exists: {f}", exists,
                   "" if exists else f"Missing required file: {f}")

    # Top-level directories
    required_dirs = ["src", "infra", "tests", "docs", "build"]
    for d in required_dirs:
        exists = check_dir_exists(base, d)
        report.add(variant, f"Directory exists: {d}/", exists,
                   "" if exists else f"Missing required directory: {d}/")

    # src/app/ must exist (ECS has single app directory)
    has_app = check_dir_exists(base, "src/app")
    report.add(variant, "src/app/ exists", has_app,
               "" if has_app else "Missing src/app/ directory for ECS application")

    # infra/ must have environment/ and modules/
    infra_subdirs = ["infra/environment", "infra/modules"]
    for d in infra_subdirs:
        exists = check_dir_exists(base, d)
        report.add(variant, f"Directory exists: {d}/", exists,
                   "" if exists else f"Missing required directory: {d}/")

    # infra/environment/ must have dev/, staging/, prod/
    env_dirs = ["infra/environment/dev", "infra/environment/staging", "infra/environment/prod"]
    for d in env_dirs:
        exists = check_dir_exists(base, d)
        report.add(variant, f"Directory exists: {d}/", exists,
                   "" if exists else f"Missing required directory: {d}/")

    # infra/environment/dev/ must have specific files per Req 6.3
    env_files = [
        "infra/environment/dev/main.tf",
        "infra/environment/dev/variables.tf",
        "infra/environment/dev/outputs.tf",
        "infra/environment/dev/backend.tf",
        "infra/environment/dev/terraform.tfvars.example",
    ]
    for f in env_files:
        exists = check_file_exists(base, f)
        report.add(variant, f"File exists: {f}", exists,
                   "" if exists else f"Missing required file: {f}")

    # infra/modules/ must include ECS-specific modules
    # Required: ecs/, vpc/, alb/ or nlb/, ecr/
    has_ecs_module = check_dir_exists(base, "infra/modules/ecs")
    report.add(variant, "infra/modules/ecs/ exists", has_ecs_module,
               "" if has_ecs_module else "Missing infra/modules/ecs/")

    has_vpc_module = check_dir_exists(base, "infra/modules/vpc")
    report.add(variant, "infra/modules/vpc/ exists", has_vpc_module,
               "" if has_vpc_module else "Missing infra/modules/vpc/")

    has_ecr_module = check_dir_exists(base, "infra/modules/ecr")
    report.add(variant, "infra/modules/ecr/ exists", has_ecr_module,
               "" if has_ecr_module else "Missing infra/modules/ecr/")

    # ALB for REST variants, NLB for WebSocket variants
    is_ws = "-ws" in variant
    if is_ws:
        has_lb = check_dir_exists(base, "infra/modules/nlb")
        report.add(variant, "infra/modules/nlb/ exists (WebSocket ECS)", has_lb,
                   "" if has_lb else "Missing infra/modules/nlb/ for WebSocket ECS variant")
    else:
        has_lb = check_dir_exists(base, "infra/modules/alb")
        report.add(variant, "infra/modules/alb/ exists (REST ECS)", has_lb,
                   "" if has_lb else "Missing infra/modules/alb/ for REST ECS variant")

    # Shared modules: dynamodb/, s3/ should still exist
    shared_modules = ["infra/modules/dynamodb", "infra/modules/s3"]
    for m in shared_modules:
        exists = check_dir_exists(base, m)
        report.add(variant, f"Directory exists: {m}/", exists,
                   "" if exists else f"Missing shared module: {m}/")


def validate_gitignore(variant: str, report: ValidationReport) -> None:
    """Validate .gitignore contains all required patterns per Req 6.5."""
    base = TEMPLATES_DIR / variant
    gitignore_path = base / ".gitignore"

    if not gitignore_path.is_file():
        report.add(variant, ".gitignore validation", False, "File does not exist")
        return

    content = gitignore_path.read_text()
    lines = [line.strip() for line in content.splitlines()]

    for pattern in REQUIRED_GITIGNORE_PATTERNS:
        # Check if the pattern exists in the gitignore (exact match or as a line)
        found = pattern in lines
        report.add(variant, f".gitignore contains: {pattern}", found,
                   "" if found else f"Missing .gitignore pattern: {pattern}")


def validate_makefile(variant: str, report: ValidationReport) -> None:
    """Validate Makefile has required targets per Req 6.6."""
    base = TEMPLATES_DIR / variant
    makefile_path = base / "Makefile"

    if not makefile_path.is_file():
        report.add(variant, "Makefile validation", False, "File does not exist")
        return

    content = makefile_path.read_text()

    # Determine required targets based on variant type
    is_ecs = variant in ECS_VARIANTS
    required_targets = ECS_MAKEFILE_TARGETS if is_ecs else LAMBDA_MAKEFILE_TARGETS

    for target in required_targets:
        # Look for target definition: "target:" at the start of a line
        found = any(
            line.startswith(f"{target}:")
            for line in content.splitlines()
        )
        report.add(variant, f"Makefile target: {target}", found,
                   "" if found else f"Missing Makefile target: {target}")


def print_report(report: ValidationReport) -> None:
    """Print the full validation report."""
    print("=" * 80)
    print("TEMPLATE ARTIFACT STRUCTURE VALIDATION REPORT")
    print("=" * 80)
    print()

    # Group results by variant
    variants_seen: list[str] = []
    for r in report.results:
        if r.variant not in variants_seen:
            variants_seen.append(r.variant)

    for variant in variants_seen:
        variant_results = [r for r in report.results if r.variant == variant]
        variant_passed = sum(1 for r in variant_results if r.passed)
        variant_failed = sum(1 for r in variant_results if not r.passed)
        variant_type = "Lambda" if variant in LAMBDA_VARIANTS else "ECS"

        status = "PASS" if variant_failed == 0 else "FAIL"
        print(f"\n{'─' * 70}")
        print(f"  [{status}] {variant} ({variant_type})")
        print(f"       Checks: {variant_passed}/{len(variant_results)} passed")
        print(f"{'─' * 70}")

        # Only show failures for brevity
        failures = [r for r in variant_results if not r.passed]
        if failures:
            for r in failures:
                print(f"    ✗ {r.check}")
                if r.details:
                    print(f"      → {r.details}")
        else:
            print("    ✓ All checks passed")

    # Summary
    print(f"\n{'=' * 80}")
    print("SUMMARY")
    print(f"{'=' * 80}")
    print(f"  Total checks: {report.total}")
    print(f"  Passed:       {report.passed_count}")
    print(f"  Failed:       {report.failed_count}")

    passed_variants = sum(
        1 for v in ALL_VARIANTS
        if all(r.passed for r in report.results if r.variant == v)
    )
    print(f"  Variants fully passing: {passed_variants}/{len(ALL_VARIANTS)}")

    if report.all_passed:
        print("\n  ✓ ALL CHECKS PASSED - Template structure is complete")
    else:
        print(f"\n  ✗ {report.failed_count} CHECKS FAILED - See details above")
    print()


def main() -> int:
    """Run all validation checks and print report."""
    report = ValidationReport()

    # Validate all variants exist
    for variant in ALL_VARIANTS:
        exists = (TEMPLATES_DIR / variant).is_dir()
        report.add(variant, "Template directory exists", exists,
                   "" if exists else f"Template directory not found: {variant}")
        if not exists:
            continue

        # Structure validation
        if variant in LAMBDA_VARIANTS:
            validate_lambda_structure(variant, report)
        else:
            validate_ecs_structure(variant, report)

        # .gitignore validation
        validate_gitignore(variant, report)

        # Makefile validation
        validate_makefile(variant, report)

    print_report(report)

    return 0 if report.all_passed else 1


if __name__ == "__main__":
    sys.exit(main())
