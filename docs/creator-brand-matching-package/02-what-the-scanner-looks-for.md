# What The Scanner Looks For

This page explains the scanner in non-technical language.

The scanner does not use ChatGPT to read emails. It uses clear rules. That keeps the scan cheaper, repeatable, and easier to audit.

## First Filter: Which Emails Are Candidate Opportunities

The scanner searches Gmail for words and phrases that usually appear in creator opportunity emails.

Examples:

- campaign
- campaign brief
- creator
- creators
- collaboration
- collab
- paid collaboration
- partnership
- sponsorship
- influencer
- ambassador
- UGC
- whitelisting
- paid usage
- affiliate
- gifted PR
- song promotion
- music promotion
- KOL
- Spark Ads

It also excludes:

- spam
- trash
- emails sent by the mailbox owner

The default Gmail search pattern is in `templates/gmail-search-query-template.txt`.

## Second Filter: Is It A Real Creator Opportunity?

The scanner tries to answer:

"Could a creator manager act on this email?"

It is more likely to keep the email if it sees:

- a brand name
- an agency or source organization
- a creator requirement
- a budget or fee
- a deliverable
- campaign language
- paid collaboration language
- affiliate language
- gifting language
- song or music promotion language
- whitelisting or usage rights language

## Emails The Scanner Usually Skips

It tries to skip:

- newsletters
- mass marketing blasts
- blog updates
- product update emails
- webinar invites
- generic PR newsletters
- account alerts
- security alerts
- password reset emails
- receipts and invoices
- personal emails
- out-of-office messages
- emails with no creator opportunity
- duplicates

## Opportunity Types It Detects

The scanner labels opportunities into useful business categories:

- Paid campaign
- Affiliate
- Song promotion
- PR gifting
- Whitelisting
- App promotion
- Agency brief
- Other

## Commercial Signals It Extracts

The scanner looks for:

- budget amount
- currency
- fixed-fee language
- affiliate commission
- affiliate-only language
- low-budget concern
- budget missing
- paid usage
- whitelisting
- deliverables
- timeline or deadline
- application process

## Brand And Agency Cleanup

The scanner tries to separate:

- real brand name
- source agency
- contact name
- contact email

It also tries to catch polluted names.

Polluted names are phrases that look like a brand but are actually email text.

Examples:

- This Creator
- Not Getting Back Earlier
- Aching Out
- The Brand
- Your Email
- Sharing This

These should not be treated as clean brands.

## Review Before Use

Some rows are useful but not clean enough to trust automatically.

The scanner sends these to review when it sees:

- unclear brand
- unclear agency
- missing budget
- low confidence extraction
- low-budget concern
- affiliate-only concern
- vague creator requirements
- historical signal but not clearly active
- possible duplicate

This is not failure. It is the safety layer.

## Matching Intelligence Created Later

After email scanning, the system builds matching intelligence:

- brand commercial reputation
- agency commercial reputation
- relationship strength
- pitch angles
- priority score
- creator signal strength
- geography strength
- historical strength

This is what makes the Custom GPT rank opportunities instead of simply searching the database.

## What The Scanner Does Not Do

It does not:

- guarantee the campaign is still active
- invent missing budgets
- invent brand names
- read attachments perfectly
- understand every forwarded thread
- replace human review

Old opportunities are treated as preference signals, not guaranteed active deals.
