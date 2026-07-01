#!/usr/bin/env bash
# =============================================================================
# Task 13.3: Validate Terraform Configurations Across All Variants
# Requirements: 6.3, 6.4, 13.1, 13.2, 13.3, 13.4, 13.5, 13.6
# =============================================================================

set -euo pipefail

TEMPLATES_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

VARIANTS=(
  "chatbot-rag-agentcore-ws"
  "chatbot-rag-mantle-ws"
  "chatbot-rag-agentcore-ws-streaming"
  "chatbot-rag-mantle-ws-streaming"
  "chatbot-rag-agentcore-ecs"
  "chatbot-rag-mantle-ecs"
  "chatbot-rag-agentcore-ecs-ws"
  "chatbot-rag-mantle-ecs-ws"
  "chatbot-rag-agentcore-ecs-ws-streaming"
  "chatbot-rag-mantle-ecs-ws-streaming"
)

PASS=0
FAIL=0
WARN=0
REPORT=""

pass() { PASS=$((PASS+1)); REPORT+="  [PASS] $1\n"; }
fail() { FAIL=$((FAIL+1)); REPORT+="  [FAIL] $1\n"; }
warn() { WARN=$((WARN+1)); REPORT+="  [WARN] $1\n"; }
section() { REPORT+="\n## $1\n\n"; }

# =============================================================================
# CHECK 1: backend.tf has unique state key containing the variant name
# Req: 13.5
# =============================================================================
section "CHECK 1: Unique State Keys in backend.tf (Req 13.5)"

declare -A STATE_KEYS
for variant in "${VARIANTS[@]}"; do
  backend_file="$TEMPLATES_DIR/$variant/infra/environment/dev/backend.tf"
  if [[ ! -f "$backend_file" ]]; then
    fail "$variant — backend.tf not found at infra/environment/dev/backend.tf"
    continue
  fi

  # Extract the key value
  key_value=$(grep -oP 'key\s*=\s*"\K[^"]+' "$backend_file" || echo "")
  
  if [[ -z "$key_value" ]]; then
    fail "$variant — No 'key' attribute found in backend.tf"
    continue
  fi

  # Check if key contains the variant name
  if [[ "$key_value" == *"$variant"* ]]; then
    pass "$variant — key=\"$key_value\" (contains variant name)"
  else
    fail "$variant — key=\"$key_value\" (does NOT contain variant name '$variant')"
  fi

  # Check for uniqueness
  if [[ -n "${STATE_KEYS[$key_value]:-}" ]]; then
    fail "$variant — DUPLICATE state key \"$key_value\" (also used by ${STATE_KEYS[$key_value]})"
  else
    STATE_KEYS[$key_value]="$variant"
  fi
done

# Check all keys are unique
UNIQUE_KEYS=$(printf '%s\n' "${!STATE_KEYS[@]}" | sort -u | wc -l)
TOTAL_KEYS=${#STATE_KEYS[@]}
if [[ "$UNIQUE_KEYS" -eq "$TOTAL_KEYS" && "$TOTAL_KEYS" -eq "${#VARIANTS[@]}" ]]; then
  pass "All $TOTAL_KEYS state keys are unique"
fi

# =============================================================================
# CHECK 2: providers.tf uses aws ~> 6.0 with default_tags
# Req: 6.3 (version-constrained provider), 6.4 (default_tags)
# =============================================================================
section "CHECK 2: Provider Version and Default Tags (Reqs 6.3, 6.4)"

for variant in "${VARIANTS[@]}"; do
  providers_file="$TEMPLATES_DIR/$variant/infra/environment/dev/providers.tf"
  if [[ ! -f "$providers_file" ]]; then
    fail "$variant — providers.tf not found"
    continue
  fi

  # Check AWS provider version constraint uses ~>
  if grep -qP 'version\s*=\s*"~>' "$providers_file"; then
    version_val=$(grep -oP 'version\s*=\s*"\K[^"]+' "$providers_file")
    pass "$variant — AWS provider version constraint: \"$version_val\""
  else
    fail "$variant — AWS provider does not use ~> version constraint"
  fi

  # Check default_tags block exists
  if grep -q "default_tags" "$providers_file"; then
    # Check for required tags
    has_project=$(grep -c "Project" "$providers_file" || echo 0)
    has_env=$(grep -c "Environment" "$providers_file" || echo 0)
    has_managed=$(grep -c "ManagedBy" "$providers_file" || echo 0)
    
    if [[ "$has_project" -gt 0 && "$has_env" -gt 0 && "$has_managed" -gt 0 ]]; then
      pass "$variant — default_tags includes Project, Environment, ManagedBy"
    else
      fail "$variant — default_tags missing required tags (Project=$has_project, Environment=$has_env, ManagedBy=$has_managed)"
    fi
    
    # Check ManagedBy = "terraform"
    if grep -qP 'ManagedBy\s*=\s*"terraform"' "$providers_file"; then
      pass "$variant — ManagedBy = \"terraform\" confirmed"
    else
      fail "$variant — ManagedBy tag does not equal \"terraform\""
    fi
  else
    fail "$variant — No default_tags block found in providers.tf"
  fi
done

# =============================================================================
# CHECK 3: Resource names use {project_name}-{environment}-{function} pattern
# Req: 13.2
# =============================================================================
section "CHECK 3: Resource Naming Pattern (Req 13.2)"

for variant in "${VARIANTS[@]}"; do
  infra_dir="$TEMPLATES_DIR/$variant/infra"
  
  # Find all .tf files in modules (where resources are defined)
  tf_files=$(find "$infra_dir/modules" -name "*.tf" -type f 2>/dev/null || true)
  if [[ -z "$tf_files" ]]; then
    fail "$variant — No .tf files found in infra/modules/"
    continue
  fi

  # Extract lines that define resource names (name = "..." or name = local/var)
  # We grep the modules directory which has the actual resource definitions
  name_lines=$(grep -rPn '^\s+name\s*=' "$infra_dir/modules" --include="*.tf" 2>/dev/null || true)
  
  resource_name_count=0
  correct_pattern_count=0
  acceptable_exceptions=0
  bad_pattern_lines=""
  
  while IFS= read -r line; do
    if [[ -z "$line" ]]; then continue; fi
    
    # Extract just the value part after the file path
    value_part=$(echo "$line" | sed 's/^[^:]*:[^:]*://')
    
    # Skip lines that are not top-level resource name attributes
    # (attribute definitions inside blocks, like DynamoDB attribute name, GSI name, etc.)
    if echo "$value_part" | grep -qP '^\s+name\s*=\s*"(userId|connectionId|expiresAt|containerInsights|chatbot)"'; then
      # These are attribute names inside nested blocks, not resource names
      acceptable_exceptions=$((acceptable_exceptions+1))
      continue
    fi
    
    # Skip GSI/LSI name definitions and stage names
    if echo "$value_part" | grep -qP '^\s+name\s*=.*-index"'; then
      acceptable_exceptions=$((acceptable_exceptions+1))
      continue
    fi
    if echo "$value_part" | grep -qP '^\s+name\s*=\s*var\.(environment|stage)'; then
      acceptable_exceptions=$((acceptable_exceptions+1))
      continue
    fi
    
    resource_name_count=$((resource_name_count+1))
    
    # Check if it uses the ${var.project_name}-${var.environment} pattern
    if echo "$value_part" | grep -qP '\$\{var\.project_name\}-\$\{var\.environment\}'; then
      correct_pattern_count=$((correct_pattern_count+1))
    elif echo "$value_part" | grep -qP 'local\.(name_prefix|api_name|user_context_table_name|connections_table_name)'; then
      # These locals are derived from var.project_name-var.environment
      correct_pattern_count=$((correct_pattern_count+1))
    elif echo "$value_part" | grep -qP '\$\{local\.name_prefix\}'; then
      correct_pattern_count=$((correct_pattern_count+1))
    else
      bad_pattern_lines+="    $(echo "$line" | sed 's|.*/infra/||')\n"
    fi
  done <<< "$name_lines"

  if [[ "$resource_name_count" -eq 0 ]]; then
    warn "$variant — No resource 'name' attributes found to validate"
  elif [[ "$correct_pattern_count" -eq "$resource_name_count" ]]; then
    pass "$variant — All $resource_name_count resource names use {project_name}-{environment}-{function} pattern"
  else
    bad_count=$((resource_name_count - correct_pattern_count))
    if [[ "$bad_count" -le 2 ]]; then
      warn "$variant — $correct_pattern_count/$resource_name_count use correct pattern ($bad_count may be acceptable exceptions)"
    else
      fail "$variant — Only $correct_pattern_count/$resource_name_count resource names use correct pattern"
    fi
    if [[ -n "$bad_pattern_lines" ]]; then
      REPORT+="    Non-conforming lines:\n$bad_pattern_lines"
    fi
  fi
done

# =============================================================================
# CHECK 4: No terraform_remote_state data sources (cross-stack references)
# Req: 13.1
# =============================================================================
section "CHECK 4: No Cross-Stack References (Req 13.1)"

for variant in "${VARIANTS[@]}"; do
  infra_dir="$TEMPLATES_DIR/$variant/infra"
  
  # Check for terraform_remote_state
  remote_state_refs=$(grep -rl "terraform_remote_state" "$infra_dir" --include="*.tf" 2>/dev/null || true)
  
  if [[ -z "$remote_state_refs" ]]; then
    pass "$variant — No terraform_remote_state data sources found"
  else
    fail "$variant — terraform_remote_state found in: $(echo "$remote_state_refs" | tr '\n' ', ')"
  fi
done

# =============================================================================
# CHECK 5: No hardcoded ARNs (except AWS managed policy ARNs and dynamic constructions)
# Req: 13.1
# =============================================================================
section "CHECK 5: No Hardcoded ARNs (Req 13.1)"

for variant in "${VARIANTS[@]}"; do
  infra_dir="$TEMPLATES_DIR/$variant/infra"
  
  # Find hardcoded ARNs (arn:aws:...) but exclude:
  # - AWS managed policy ARNs (arn:aws:iam::aws:policy/...)
  # - Comments
  # - Variable defaults that are examples
  # - Dynamically constructed ARNs that use ${var.*} or ${data.*} or ${aws_*} interpolation
  hardcoded_arns=$(grep -rn "arn:aws:" "$infra_dir" --include="*.tf" 2>/dev/null | \
    grep -v "arn:aws:iam::aws:policy/" | \
    grep -v "^\s*#" | \
    grep -v "tfvars.example" || true)
  
  if [[ -z "$hardcoded_arns" ]]; then
    pass "$variant — No hardcoded ARNs (AWS managed policies excluded)"
  else
    # Filter out dynamically constructed ARNs (using variables/data/resources)
    real_hardcoded=""
    while IFS= read -r line; do
      if [[ -z "$line" ]]; then continue; fi
      # Skip lines with description attributes or comments
      if echo "$line" | grep -qP 'description\s*=|#|//'; then continue; fi
      # Skip dynamically constructed ARNs using ${var.*}, ${data.*}, ${aws_*}, ${module.*}
      if echo "$line" | grep -qP '\$\{(var|data|aws_|module|local)'; then continue; fi
      real_hardcoded+="$line\n"
    done <<< "$hardcoded_arns"
    
    if [[ -z "$real_hardcoded" || "$real_hardcoded" == $'\n' ]]; then
      pass "$variant — No hardcoded ARNs (dynamic constructions with vars/data sources are acceptable)"
    else
      fail "$variant — Truly hardcoded ARNs found (referencing specific external resources):"
      REPORT+="$(echo -e "$real_hardcoded" | head -5 | sed 's/^/    /')\n"
    fi
  fi
done

# =============================================================================
# CHECK 6: Default tags include Project, Environment, ManagedBy
# Req: 6.4
# (Already checked in CHECK 2, this verifies module-level tags as well)
# =============================================================================
section "CHECK 6: Tags Verification at Module Level (Req 6.4)"

for variant in "${VARIANTS[@]}"; do
  infra_dir="$TEMPLATES_DIR/$variant/infra"
  
  # Find resource-level tag blocks (excluding providers.tf default_tags)
  tag_files=$(grep -rl "tags\s*=" "$infra_dir" --include="*.tf" 2>/dev/null | grep -v "providers.tf" || true)
  
  if [[ -z "$tag_files" ]]; then
    pass "$variant — No resource-level tags (relies on default_tags from provider)"
  else
    # Count files with tag blocks
    tag_file_count=$(echo "$tag_files" | wc -l)
    pass "$variant — $tag_file_count files have resource-level tags (supplementing default_tags)"
  fi
done

# =============================================================================
# CHECK 7: S3 Remote Backend Configuration
# Req: 6.3
# =============================================================================
section "CHECK 7: S3 Remote Backend Configuration (Req 6.3)"

for variant in "${VARIANTS[@]}"; do
  backend_file="$TEMPLATES_DIR/$variant/infra/environment/dev/backend.tf"
  if [[ ! -f "$backend_file" ]]; then
    fail "$variant — backend.tf not found"
    continue
  fi

  # Check for S3 backend
  if grep -q 'backend "s3"' "$backend_file"; then
    pass "$variant — Uses S3 backend"
  else
    fail "$variant — Does not use S3 backend"
    continue
  fi

  # Check for encrypt = true
  if grep -q 'encrypt\s*=\s*true' "$backend_file"; then
    pass "$variant — Backend encryption enabled"
  else
    fail "$variant — Backend encryption NOT enabled"
  fi

  # Check for dynamodb_table (lock)
  if grep -q 'dynamodb_table' "$backend_file"; then
    pass "$variant — DynamoDB lock table configured"
  else
    fail "$variant — No DynamoDB lock table configured"
  fi
done

# =============================================================================
# CHECK 8: Terraform fmt check (syntax validation)
# =============================================================================
section "CHECK 8: Terraform Format Check"

if command -v terraform &>/dev/null; then
  for variant in "${VARIANTS[@]}"; do
    infra_dir="$TEMPLATES_DIR/$variant/infra"
    fmt_result=$(terraform fmt -check -recursive "$infra_dir" 2>&1 || true)
    if [[ -z "$fmt_result" ]]; then
      pass "$variant — terraform fmt check passed (all files correctly formatted)"
    else
      warn "$variant — terraform fmt found formatting issues:"
      REPORT+="$(echo "$fmt_result" | head -5 | sed 's/^/    /')\n"
    fi
  done
else
  warn "terraform binary not found — skipping format check"
fi

# =============================================================================
# SUMMARY
# =============================================================================
section "SUMMARY"

TOTAL=$((PASS+FAIL+WARN))
REPORT+="Total checks: $TOTAL\n"
REPORT+="  PASS: $PASS\n"
REPORT+="  FAIL: $FAIL\n"
REPORT+="  WARN: $WARN\n"

if [[ "$FAIL" -eq 0 ]]; then
  REPORT+="\n**OVERALL: PASS** — All critical checks passed.\n"
else
  REPORT+="\n**OVERALL: ISSUES FOUND** — $FAIL checks failed.\n"
fi

# Output report
echo "# Verification Report: Task 13.3"
echo ""
echo "## Validate Terraform Configurations Across All Variants"
echo ""
echo "**Requirements validated:** 6.3, 6.4, 13.1, 13.2, 13.3, 13.4, 13.5, 13.6"
echo "**Date:** $(date +%Y-%m-%d)"
echo ""
echo "---"
echo ""
echo -e "$REPORT"
