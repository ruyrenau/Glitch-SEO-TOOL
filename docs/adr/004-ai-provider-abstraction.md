# ADR 004: AI Provider Abstraction and Zero-Cost Execution

## Context
The platform must function fully without requiring paid third-party AI APIs (OpenAI/Anthropic), while allowing optional AI augmentation when configured.

## Decision
Implement a decoupled AI connector interface with a local rule-based mock engine as the default fallback.

## Consequences
- The application runs out-of-the-box in local and demo environments at zero cost.
