# Core data model

Earlier seed outline. Where it differs, CORE_MODEL.md and ADRs 0001/0002 take precedence (for example brokerage registration and effective-dated broker of record).

## Organization
- Organization
- Branch
- Team
- User
- Membership
- Role
- PermissionGrant

## Parties and CRM
- Party (person or organization)
- PersonProfile
- OrganizationProfile
- Household
- Relationship
- ContactPoint
- ConsentRecord
- Note
- Activity

## Sales and service
- Lead
- LeadAssignment
- Opportunity
- ServiceType
- ServiceEngagement

## Property
- Property
- PropertyUnit
- PropertyAddress
- OwnershipInterest
- Listing
- Valuation
- Tenancy

## Transactions/work
- Transaction
- TransactionParty
- TransactionStage
- WorkflowTemplate
- WorkflowInstance
- WorkflowStep
- Task
- TaskDependency
- ApprovalRequest

## Documents
- Document
- DocumentVersion
- DocumentRequirement
- SignatureEnvelope
- SignatureParticipant
- RetentionPolicy

## Communications
- Communication
- ConversationThread
- CalendarEvent
- Notification

## Compliance
- ComplianceCase
- ComplianceRequirement
- IdentityVerification
- ReceiptOfFundsRecord
- ThirdPartyDetermination
- BeneficialOwnershipRecord
- RiskAssessment
- TradeRecordSheet
- TrustReconciliationRecord
- RegulatoryFilingRecord

## Finance
- CommissionEstimate
- CommissionStatement
- ReferralFee
- InvoiceReference
- ExpenseReference
- TrustMoneyRecord (operational tracking only; accounting system remains authoritative)

## Platform/integration
- IntegrationConnection
- ExternalReference
- WebhookEvent
- SyncCursor
- DomainEvent
- AutomationRule
- AgentJob
- AgentCapability
- AgentApproval
- AuditEvent

## Important modelling rules
- Property != Listing != Transaction.
- Lead != Client != Transaction.
- Person/company identity is separate from the roles they play in a deal.
- A service engagement can exist without a real-estate trade.
- Compliance records are attached to the correct client/transaction/receipt, not to a generic contact checklist.
- External provider IDs are stored as references, never as primary domain IDs.
