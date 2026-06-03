# GPT Evaluation Checklist

Use this checklist after the Creator Brand Matching GPT is built. The goal is to decide whether its recommendations are manager-useful, not just technically relevant.

## Pass/Fail Summary

Reviewer:

Test date:

GPT version:

Knowledge export folder used:

Overall result: Pass / Needs Fix / Fail

## Core Evaluation Rules

A good answer should:

- Ask a short questionnaire when the creator profile is incomplete.
- Rank a small number of strong matches first.
- Explain why each match fits the creator.
- Use niche, geography, and audience before platform.
- Prefer fixed-fee opportunities.
- Treat agencies as relationship assets, not campaigns.
- Treat historical campaigns as pitch signals, not guaranteed active deals.
- Say "budget needs confirmation" when budget is unclear.
- Avoid affiliate-only unless the user asks for affiliate.
- Avoid low-budget deals when the creator has a higher fee floor.
- Avoid review-before-use style rows and polluted brand names.

## Scorecard

Score each category from 1 to 5.

1 means poor. 3 means usable but needs review. 5 means manager-ready.

## 1. Creator Fit

Score:

What to check:

- Did it match the creator's niche?
- Did it match the creator's country or target geography?
- Did it use audience detail when available?
- Did it avoid relying only on platform?
- Did it respect the creator's size and fee floor?

Bad signs:

- Recommends a beauty campaign to a sports creator with no angle.
- Recommends US-only campaigns to a UK-only creator.
- Recommends TikTok campaigns only because the creator uses TikTok.

## 2. Commercial Quality

Score:

What to check:

- Did it prefer fixed-fee opportunities?
- Did it downgrade affiliate-only?
- Did it call out unclear budget?
- Did it avoid low-budget rows for large creators?
- Did it handle song promotion economics separately?

Bad signs:

- Treats affiliate-only as equal to paid campaigns.
- Recommends gifting as a top commercial match.
- Ignores the creator's minimum fee.
- Fails to mention budget uncertainty.

## 3. Relationship Intelligence

Score:

What to check:

- Did it identify warm agencies or brands?
- Did it explain agencies as current-brief routes?
- Did it avoid treating an agency as the actual campaign?
- Did it use relationship strength to support ranking?

Bad signs:

- Says an agency is the brand.
- Recommends old agency campaigns as if they are definitely active.
- Ignores repeated historical contact with an agency.

## 4. Pitch Angle Quality

Score:

What to check:

- Did it give clear pitch reasons?
- Did it combine niche plus geography where possible?
- Did it include useful angles like UK Creator, Parenting Creator, Tech Creator, Beauty Creator, Music Creator?
- Did it avoid generic explanations?

Bad signs:

- Says "good fit" without explaining why.
- Uses vague pitch angles like "content creator".
- Misses obvious crossover angles like beauty plus mom.

## 5. Ranking Quality

Score:

What to check:

- Did it return the best few matches first?
- Did it avoid huge lists?
- Did it separate direct opportunities from supporting signals?
- Did it rank commercial and relationship quality above raw quantity?

Bad signs:

- Gives 20 plus options with no prioritization.
- Ranks low-budget rows above stronger fixed-fee rows.
- Puts Tier 3 support signals above stronger Tier 1 or Tier 2 matches without a good reason.

## 6. Risk Handling

Score:

What to check:

- Did it flag budget needs confirmation?
- Did it flag old or historical campaigns?
- Did it warn about affiliate-only or gifting?
- Did it avoid polluted brand names?
- Did it avoid review-before-use rows?

Bad signs:

- Recommends "Aching Out", "Not Getting Back Earlier", "This Creator", or similar polluted names.
- Presents historical campaigns as currently open.
- Hides affiliate or low-budget caveats.

## 7. Actionability

Score:

What to check:

- Did it suggest what the manager should do next?
- Did it include what to ask the agency or brand?
- Did it explain what needs confirmation?
- Did it keep the answer short enough to use?

Bad signs:

- Gives generic strategy instead of usable next steps.
- Does not say what to ask the agency.
- Does not separate confirmed information from assumptions.

## Recommended Review Process

1. Pick 5 scenarios from gpt-test-scenarios.md.
2. Paste one creator profile into the future GPT.
3. Let the GPT ask its questionnaire if needed.
4. Answer the questionnaire with realistic details.
5. Review the final recommendations using this checklist.
6. Score each category from 1 to 5.
7. Record bad recommendations and why they failed.
8. Repeat until the GPT consistently scores 4 or higher in most categories.

## Decision Guide

Ready to use:

- Average score is 4.2 or higher.
- No polluted brand names appear.
- No affiliate-only offers are recommended unless requested.
- Historical campaigns are clearly labeled as historical signals.
- Recommendations are ranked, not dumped.

Needs prompt or instruction fix:

- Average score is 3.2 to 4.1.
- It usually gets the category right but misses caveats.
- It asks too many questions or too few questions.
- It overuses Tier 1 without explaining fit.

Needs knowledge/export fix:

- Average score is below 3.2.
- It recommends bad brand names.
- It repeatedly suggests wrong categories.
- It cannot distinguish agency, brand, and campaign.
- It ignores budget quality.

## Reviewer Notes Template

Scenario tested:

Creator profile:

GPT top matches:

Good outputs:

Bad outputs:

Missing caveats:

Wrong recommendations:

Score by category:

- Creator Fit:
- Commercial Quality:
- Relationship Intelligence:
- Pitch Angle Quality:
- Ranking Quality:
- Risk Handling:
- Actionability:

Final verdict:

Fix needed:

