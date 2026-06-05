# Google Sheet Database Template

This system needs one Google Sheet. Think of it as the private database.

The email scanner reads Gmail, then writes clean rows into this Sheet. The GPT export reads this Sheet later and turns it into upload files for GPT Builder.

## Required Tabs

Create these tabs exactly:

```text
Opportunities
Organizations
Brands
Contacts
Extraction Review
Ingestion Log
Brand Intelligence
Agency Intelligence
Contact Intelligence
Creator Matching Signals
Alias Mapping
```

If one name is misspelled, the scanner may fail or the export may miss data.

## What Each Tab Does

| Tab                      | Plain English Purpose                                                                                                         |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| Opportunities            | Every creator-brand opportunity found from email.                                                                             |
| Organizations            | Agencies, brand teams, platforms, and sources that send opportunities.                                                        |
| Brands                   | Brands mentioned in campaigns or outreach.                                                                                    |
| Contacts                 | People and email addresses connected to opportunities.                                                                        |
| Extraction Review        | Rows that should not be trusted yet. This catches unclear brands, missing budgets, low confidence, and suspicious extraction. |
| Ingestion Log            | A record of scanner runs, row counts, and checkpoints.                                                                        |
| Brand Intelligence       | Brand-level summary used for matching.                                                                                        |
| Agency Intelligence      | Agency-level summary used for relationship and pitch decisions.                                                               |
| Contact Intelligence     | Contact-level summary used for relationship context.                                                                          |
| Creator Matching Signals | Matching patterns by brand, niche, country, audience, and platform.                                                           |
| Alias Mapping            | Manual cleanup table for duplicate names, spelling variants, and brand/agency aliases.                                        |

## Starter Header Rows

The easiest setup is to copy an existing working database and clear the old rows.

If starting from a blank Sheet, add these starter headers. The system can still add, refresh, or export intelligence later, but the core tabs should have clear headers from day one.

### Opportunities

```text
Opportunity ID
Source Email ID
Source Email Date
Source Email Subject
Source Email Link
Extracted At
Last Updated
Opportunity Name
Opportunity Type
Opportunity Status
Brand Name
Brand Category
Source Organization Name
Source Organization Type
Contact Name
Contact Email
Contact Role
Campaign Summary
Creator Gender Requirement
Creator Country Requirement
Creator Language Requirement
Creator Platform Requirement
Creator Niche Requirement
Audience Requirement
Follower Range Requirement
Engagement Requirement
Special Creator Requirements
Budget Amount
Budget Currency
Budget Notes
Affiliate Commission
Deliverables
Usage Rights
Whitelisting / Paid Media
Exclusivity
Timeline / Deadline
Application Process
Open To Pitching?
Matching Keywords
Confidence Score
Needs Human Review
Review Notes
Account Owner
Last Owner
Member Tag / Deal Code
Relationship Notes
Brand Preference Tags
Creator Match Tags
Requirement Confidence
Commercial Quality
Budget Rating
Minimum Budget Concern
Typical Budget Range
Expected Deal Value
Commercial Notes
Last Communication Date
Communication Recency
Communication Status
Historical Value
Still Useful For Matching?
Opportunity Relevance Type
Opportunity Age Notes
Commercial Quality Score
Relationship Score
Recency Score
Disqualifier Flags
Ranking Notes
Recommended Pitch Angle
Budget Floor Concern
Fixed Fee Present?
Affiliate Present?
Affiliate Only?
Song Promotion Exception?
Historical Outcome
Outcome Notes
Won Before?
Lost Before?
Revenue Generated
Approx Deal Value
Success Signal
Budget Penalty Score
Affiliate Penalty Score
Disqualifier Penalty Score
Source Strength
```

### Organizations

```text
Organization ID
Organization Name
Organization Type
Primary Contact Email
Primary Contact Name
Total Opportunities Found
Brands Represented
Last Seen
Relationship Notes
Confidence Score
Needs Human Review
Last Communication Date
Communication Recency
Communication Status
Brands Represented Normalized
Typical Opportunity Types
Typical Commercial Quality
Commercial Notes
Weekly Update Eligible?
Opportunity Volume
Agency Usefulness
Budget Pattern
```

### Brands

```text
Brand ID
Brand Name
Parent Organization
Category
Country / Market
Total Opportunities Found
Most Common Opportunity Type
Most Common Creator Requirement
Most Common Platform
Typical Budget Range
Typical Usage Rights
Typical Exclusivity
Last Seen
Brand Notes
Confidence Score
Needs Human Review
Brand Preference Tags
Known Preferences
Typical Creator Gender
Typical Creator Country
Typical Creator Language
Typical Creator Platform
Typical Creator Niches
Typical Audience Requirements
Typical Opportunity Types
Commercial Quality
Budget Floor Concern
Minimum Budget Concern
Last Communication Date
Communication Recency
Communication Status
Historical Preference Value
Still Useful For Matching?
Recommended Pitch Angle
Weekly Update Eligible?
```

### Contacts

```text
Contact ID
Contact Name
Email
Organization
Role
Brands Mentioned
Total Opportunities Sent
Last Seen
Notes
Confidence Score
Needs Human Review
Last Communication Date
Communication Recency
Communication Status
Brands Represented Normalized
Typical Opportunity Types
Typical Creator Preferences
Commercial Quality
Best Use
```

### Extraction Review

```text
Review ID
Source Email ID
Source Email Date
Source Email Subject
Source Email Link
Issue Type
Extracted Guess
Reason For Review
Suggested Fix
Reviewed?
Suggested Brand Preference Tags
Suggested Commercial Quality
Suggested Relevance Type
Suggested Priority
Reviewer Decision
```

### Ingestion Log

```text
Run ID
Started At
Finished At
Mode
Query
Emails Scanned
Relevant Emails Found
Opportunities Created
Opportunities Updated
Duplicates Skipped
Brands Created
Agencies Created
Contacts Created
Review Items Created
Aliases Created
Last Successful Scan Date
Resume Cursor / Page Token
Rows Created
Rows Updated
Rows Skipped
Manual Review Required
Relevant Email Rate
Skipped Irrelevant
Review Needed Emails
Weekly Automation Ready?
Notes For Next Scan
```

### Alias Mapping

```text
Entity Type
Observed Name
Canonical Name
Occurrences
Confidence
Suggested Action
Approved?
```

## Intelligence Tabs

The intelligence tabs summarize the database for the future GPT.

For a new install, create the tab names first. The refresh/export scripts can then fill or refresh the rows.

Use these simple starter headers:

### Brand Intelligence

```text
Brand Name
Total Opportunities
Commercial Quality
Typical Opportunity Types
Typical Creator Niches
Typical Creator Countries
Typical Platforms
Typical Budget Range
Affiliate Tendency
Fixed Fee Tendency
Song Promotion Tendency
Relationship Strength
Recommended Pitch Angle
Priority Notes
```

### Agency Intelligence

```text
Agency Name
Total Opportunities
Brands Represented
Typical Opportunity Types
Typical Commercial Quality
Budget Pattern
Agency Usefulness
Relationship Strength
Recommended Pitch Angle
Priority Notes
```

### Contact Intelligence

```text
Contact Name
Email
Organization
Total Opportunities
Brands Mentioned
Commercial Quality
Relationship Strength
Best Use
```

### Creator Matching Signals

```text
Brand
Country Signals
Gender Signals
Niche Signals
Audience Signals
Platform Signals
Campaign Type Signals
Commercial Quality
Budget Floor Concern
Affiliate Penalty
Historical Success Pattern
Relationship Strength
Preference Strength
Still Valuable For Matching
Recommended Priority Tier
Matching Notes
```

## Setup Checklist

Use this before running the scanner:

```text
[ ] Spreadsheet created
[ ] All required tabs created with exact names
[ ] Header row added to core tabs
[ ] Service account email has Editor access
[ ] Spreadsheet ID copied into GitHub Secrets
[ ] Preflight passes
[ ] Backup created before live ingestion
```

## Important Notes

Do not rename tabs after setup.

Do not delete columns from the core tabs unless a developer updates the code too.

It is okay to add extra columns at the end for human notes.

Keep `Extraction Review` visible. That tab is a safety net, not a mistake.
