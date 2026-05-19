#!/bin/bash
# Replays promote scan output with realistic timing and colors
clear

# ANSI codes
CYAN='\033[36m'
GREEN='\033[32m'
DIM='\033[2m'
BOLD='\033[1m'
RESET='\033[0m'
ITALIC='\033[3m'

s() { sleep "$1"; }

echo -e "${DIM}❯${RESET} promote scan --repo trpc/trpc --since 60d"
echo ""
echo -e "  (*o*) ${DIM}>${RESET} Scanning trpc/trpc (last 60 days)"
echo -e "${DIM}──────────────────────────────────────────────────${RESET}"
s 0.8

# Fetch
printf "⠋ Fetching review comments..."
s 0.3; printf "\r⠙ Fetching review comments... ${DIM}(32)${RESET}"
s 0.3; printf "\r⠹ Fetching review comments... ${DIM}(98)${RESET}"
s 0.3; printf "\r⠸ Fetching review comments... ${DIM}(179)${RESET}"
s 0.2; printf "\r${GREEN}✔${RESET} Fetched 179 review comments                    \n"

echo -e "  ${DIM}AI reviewer comments:${RESET} ${BOLD}158${RESET}"
echo -e "  ${DIM}Human comments:${RESET} ${BOLD}21${RESET}"
echo -e "  ${DIM}Actionable AI comments:${RESET} ${BOLD}154${RESET}"
echo -e "  ${DIM}Noise filtered:${RESET} ${BOLD}4${RESET}"
s 0.3

# Normalize
printf "⠋ Normalizing..."
s 0.4; printf "\r${GREEN}✔${RESET} Normalized 154 comments       \n"
echo -e "  ${DIM}PRs scanned:${RESET} ${BOLD}29${RESET}"
s 0.3

# Clustering
SPARKLES=("✦" "✶" "✧" "✷" "✸" "✹" "⊹" "✺")
CLUSTER_MSGS=(
  "Grouping similar comments..."
  "Finding patterns in the noise..."
  "Comparing review comments..."
  "Matching repeated signals..."
  "Building comment clusters..."
  "Detecting repeated themes..."
)

for i in $(seq 1 12); do
  idx=$((RANDOM % ${#SPARKLES[@]}))
  midx=$((RANDOM % ${#CLUSTER_MSGS[@]}))
  printf "\r⠙ ${DIM}[clustering]${RESET} ${CYAN}${SPARKLES[$idx]}${RESET} ${DIM}${CLUSTER_MSGS[$midx]}${RESET} ${DIM}(${i}s)${RESET}       "
  s 0.4
done
printf "\r${GREEN}✔${RESET} Found 94 clusters (LLM direct) ${DIM}(38s)${RESET}               \n"

echo -e "  ${DIM}Repeated clusters:${RESET} ${BOLD}13${RESET} ${DIM}(>= 3 occurrences)${RESET}"
echo -e "${DIM}──────────────────────────────────────────────────${RESET}"
s 0.3

# Memory scan
printf "⠋ Scanning existing memory files..."
s 0.5; printf "\r${GREEN}✔${RESET} No existing memory files found             \n"
s 0.3

# Classification results
CLASSIFY_MSGS=(
  "AGENTS.md or ADR? Hmm..."
  "Is this a rule or a decision?"
  "Routing to the right destination..."
  "Convention or one-off?"
  "Should future agents know this?"
  "Weighing the evidence..."
  "Picking up lost decisions..."
)

results=(
  "p|[path_scoped_rule] Use named imports for React hooks in test files|0.85"
  "s|Streaming response content-type inconsistency"
  "t|[test] createProxy valueOf/toString must not break chaining|0.85"
  "s|getRouterInputsHash O(n^2) performance issue"
  "a|[agents] Use placeholder paths in documentation examples|0.85"
  "s|Duplicate comment in same PR"
  "a|[agents] Avoid parameter destructuring in function signatures|0.85"
  "t|[test] JsonValue schema must not use bare self-reference|0.85"
  "s|Typo correction: occured → occurred"
  "a|[agents] Avoid temporal dead zone in subscription helpers|0.85"
  "p|[path_scoped_rule] bin entry must be included in files array|0.85"
  "p|[path_scoped_rule] Do not expose generic intent binary name|0.95"
  "p|[path_scoped_rule] bin files must exist before publishing|0.85"
)

total=${#results[@]}
for i in $(seq 0 $((total - 1))); do
  num=$((i + 1))

  # Show spinner while "processing"
  for j in $(seq 1 6); do
    midx=$((RANDOM % ${#CLASSIFY_MSGS[@]}))
    sidx=$((RANDOM % ${#SPARKLES[@]}))
    printf "\r⠙ ${DIM}[${num}/${total}]${RESET} ${CYAN}${SPARKLES[$sidx]}${RESET} ${DIM}${CLASSIFY_MSGS[$midx]}${RESET} ${DIM}(${j}s)${RESET}                              "
    s 0.3
  done

  # Print result
  IFS='|' read -r type text conf <<< "${results[$i]}"

  if [ "$type" = "s" ]; then
    printf "\r  ${DIM}[${num}/${total}]${RESET} ${DIM}skip — ${text}${RESET}                                              \n"
  elif [ "$type" = "a" ]; then
    printf "\r  ${DIM}[${num}/${total}]${RESET} ${CYAN}${text}${RESET} ${DIM}(${conf})${RESET}                            \n"
  elif [ "$type" = "p" ]; then
    printf "\r  ${DIM}[${num}/${total}]${RESET} ${CYAN}${text}${RESET} ${DIM}(${conf})${RESET}                            \n"
  elif [ "$type" = "t" ]; then
    printf "\r  ${DIM}[${num}/${total}]${RESET} ${CYAN}${text}${RESET} ${DIM}(${conf})${RESET}                            \n"
  fi
done

echo -e "${DIM}──────────────────────────────────────────────────${RESET}"
echo -e "  ${DIM}Total tokens:${RESET} ${BOLD}49090${RESET}"
echo -e "  ${DIM}Estimated cost:${RESET} ${BOLD}\$0.25${RESET}"
echo -e "${DIM}──────────────────────────────────────────────────${RESET}"
s 0.3

echo -e "  (^o^) ${DIM}>${RESET} ${BOLD}8 candidate(s) found!${RESET}"
echo -e "${GREEN}✓${RESET} Digest written to .promote/digests/2026-05-19.md"
echo ""
echo -e "  ${CYAN}path_scoped_rule${RESET}: 4 candidate(s)"
echo -e "  ${CYAN}agents${RESET}: 3 candidate(s)"
echo -e "  ${CYAN}test${RESET}: 1 candidate(s)"
echo ""
echo -e "  ${CYAN}[path_scoped_rule]${RESET} Use named imports for React hooks in test files"
echo -e "  ${DIM}  → .claude/rules/react-imports.instructions.md (confidence: 0.85)${RESET}"
echo -e "  ${CYAN}[agents]${RESET} Use placeholder paths in documentation examples"
echo -e "  ${DIM}  → CLAUDE.md (confidence: 0.85)${RESET}"
echo -e "  ${CYAN}[agents]${RESET} Avoid parameter destructuring in function signatures"
echo -e "  ${DIM}  → CLAUDE.md (confidence: 0.85)${RESET}"
echo -e "  ${DIM}... and 5 more in digest${RESET}"
echo -e "${DIM}──────────────────────────────────────────────────${RESET}"
s 1

# Review prompt
echo ""
printf "◆  Review candidates now?\n"
printf "│  ${CYAN}●${RESET} Yes, review one by one\n"
printf "│  ○ No, I'll review the digest later\n"
printf "└\n"
s 2

# User selects "Yes"
printf "\r◇  Review candidates now?\n"
printf "│  Yes, review one by one\n"
s 1

# Show first candidate
echo ""
echo -e "  (*o*) ${DIM}>${RESET} 8 candidate(s) to review. Let's go through them."
echo ""
echo -e "  ${BOLD}${CYAN}─── Candidate 1/8 ───${RESET}"
echo ""
echo -e "  ${BOLD}Use named imports for React hooks in test files${RESET}"
echo ""
echo -e "  ${DIM}Target${RESET}      ${CYAN}path_scoped_rule${RESET}${DIM} → .claude/rules/react-imports.instructions.md${RESET}"
echo -e "  ${DIM}Confidence${RESET}  0.85"
echo -e "  ${DIM}Occurrences${RESET} 3"
echo -e "  ${DIM}Path scope${RESET}  packages/tanstack-react-query/test/**"
echo ""
echo -e "  ${DIM}Evidence:${RESET}"
echo -e "    ${DIM}PR #7362${RESET} packages/tanstack-react-query/test/polymorphism.test.tsx"
echo -e "    ${DIM}PR #7362${RESET} packages/tanstack-react-query/test/client.test.tsx"
echo -e "    ${DIM}PR #7362${RESET} packages/tanstack-react-query/test/infiniteQueryOptions.test.tsx"
echo ""
echo -e "  ${DIM}Patch:${RESET}"
echo -e "  ${GREEN}  ---${RESET}"
echo -e "  ${GREEN}  applyTo: \"packages/tanstack-react-query/test/**\"${RESET}"
echo -e "  ${GREEN}  ---${RESET}"
echo -e "  ${GREEN}  # React Hooks Import Convention${RESET}"
echo -e "  ${GREEN}  - Use named imports: import { useState } from 'react'${RESET}"
echo -e "  ${GREEN}  - Avoid default import: import React from 'react'${RESET}"
echo ""

printf "◆  What do you want to do with this candidate?\n"
printf "│  ${CYAN}●${RESET} Promote → path_scoped_rule\n"
printf "│  ○ Promote (different target)\n"
printf "│  ○ Show full patch\n"
printf "│  ○ Skip\n"
printf "└\n"
s 3
