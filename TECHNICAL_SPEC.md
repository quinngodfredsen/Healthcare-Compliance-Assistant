# Healthcare Compliance Audit Assistant - Technical Specification

## 1. Product Overview

### Purpose
Automate the matching of healthcare audit questions with policy evidence to streamline regulatory compliance verification.

### User Flow
1. User uploads PDF containing audit questions
2. System extracts questions using LLM
3. System searches policy database for matching evidence
4. Display results with compliance status and evidence excerpts

### Success Criteria
- Extract audit questions from PDF with 95%+ accuracy
- Match questions to policy evidence with relevant excerpts
- Process typical audit PDF (20-50 questions) in < 30 seconds
- Deploy as live URL
- Provide GitHub repository with clean code

---

## 2. System Architecture

```
┌─────────────────┐
│   Frontend      │
│   (Next.js)     │
│                 │
│  - File Upload  │
│  - Results UI   │
└────────┬────────┘
         │
         │ HTTP POST /api/analyze
         │
         ▼
┌─────────────────┐
│   API Route     │
│  (Next.js API)  │
│                 │
│  /api/analyze   │
└────────┬────────┘
         │
         ├─────────────────┐
         │                 │
         ▼                 ▼
┌─────────────────┐  ┌──────────────────┐
│  PDF Parser     │  │  DeepSeek API    │
│  (pdf-parse)    │  │  (LLM Service)   │
│                 │  │                  │
│  Extract text   │  │  - Extract Q's   │
│  from PDF       │  │  - Match policy  │
└─────────────────┘  │  - Find evidence │
                     └──────────────────┘
```

### Technology Stack

**Frontend:**
- Next.js 16 (React 19)
- TypeScript
- Tailwind CSS v3
- shadcn/ui components

**Backend:**
- Next.js API Routes
- DeepSeek API (`deepseek-chat`)
- pdf-parse for PDF text extraction

**Deployment:**
- Vercel (frontend + API)

---

## 3. API Design

### POST `/api/analyze`

**Purpose:** Process uploaded PDF and return audit questions with evidence

**Request:**
```typescript
// multipart/form-data
{
  file: File (PDF)
  policyContext?: string (optional - policy documents to search)
}
```

**Response:**
```typescript
{
  success: boolean
  questions: AuditQuestion[]
  processingTime: number
  error?: string
}

interface AuditQuestion {
  id: string
  number: number
  text: string
  status: "met" | "not-met" | "under-review"
  evidence?: {
    policyName: string
    policyNumber: string
    page: string
    excerpt: string
    confidence?: number // 0-1 score
  }
}
```

**Error Responses:**
- 400: Invalid file format
- 413: File too large (> 10MB)
- 500: Processing error

---

## 4. Data Models

### AuditQuestion
```typescript
interface AuditQuestion {
  id: string                    // Unique identifier
  number: number                // Question number from PDF
  text: string                  // Full question text
  status: ComplianceStatus      // Compliance status
  evidence?: Evidence           // Policy evidence (if met)
}

type ComplianceStatus = "met" | "not-met" | "under-review"
```

### Evidence
```typescript
interface Evidence {
  policyName: string      // e.g., "Authorization and Processing of Referrals"
  policyNumber: string    // e.g., "GG.1508"
  page: string           // e.g., "10 of 25"
  excerpt: string        // Relevant policy text excerpt
  confidence?: number    // Match confidence 0-1 (optional)
}
```

---

## 5. DeepSeek Integration Strategy

### API Configuration
```typescript
{
  baseURL: "https://api.deepseek.com/v1"
  model: "deepseek-chat"
  temperature: 0.1  // Low for consistent extraction
  max_tokens: 4000
}
```

### Prompt Strategy

#### Phase 1: Question Extraction
```
Role: Expert healthcare compliance analyst
Task: Extract audit questions from the provided PDF text

Input: [PDF Text]

Output Format (JSON):
{
  "questions": [
    {
      "number": 1,
      "text": "Full question text here"
    }
  ]
}

Rules:
- Extract all compliance questions
- Preserve exact wording
- Number sequentially
- Return valid JSON only
```

#### Phase 2: Evidence Matching
```
Role: Healthcare policy expert
Task: Match audit question with policy evidence

Question: [Audit Question]
Policy Documents: [Policy Database/Context]

Analyze if the question requirement is met by the policies.

Output Format (JSON):
{
  "status": "met" | "not-met" | "under-review",
  "evidence": {
    "policyName": "...",
    "policyNumber": "...",
    "page": "...",
    "excerpt": "...",
    "confidence": 0.95
  }
}

Rules:
- Status "met" requires explicit policy support
- Include most relevant excerpt (max 500 chars)
- Confidence: 0.9+ for "met", <0.5 for "not-met"
```

### Token Management
- Average PDF: ~5,000 tokens (input)
- Per question analysis: ~1,500 tokens
- Total per PDF: ~10,000-15,000 tokens
- Cost estimate: ~$0.02-$0.03 per PDF

---

## 6. PDF Parsing Approach

### Library: `pdf-parse`
```bash
npm install pdf-parse
```

### Implementation
```typescript
import pdf from 'pdf-parse'

async function extractTextFromPDF(buffer: Buffer): Promise<string> {
  const data = await pdf(buffer)
  return data.text
}
```

### Challenges & Solutions

**Challenge 1: Multi-column layouts**
- Solution: Use text position data to reconstruct logical flow
- Fallback: Treat as single column, let LLM handle structure

**Challenge 2: Tables/formatting**
- Solution: LLM is robust to formatting variations
- Focus on text extraction accuracy

**Challenge 3: Large PDFs**
- Solution: Process in chunks if > 20 pages
- Implement streaming for progress updates

---

## 7. Implementation Phases

### Phase 1: Core Backend (MVP)
**Priority: HIGH | Time: 1-2 hours**

- [x] Create `/api/analyze` endpoint
- [x] Integrate pdf-parse for text extraction
- [x] Connect DeepSeek API
- [x] Implement question extraction prompt
- [x] Return structured JSON response

**Deliverable:** Working API that extracts questions from PDF

### Phase 2: Policy Matching
**Priority: HIGH | Time: 1 hour**

- [ ] Define policy database structure
- [ ] Implement evidence matching prompt
- [ ] Add confidence scoring
- [ ] Handle no-match scenarios

**Deliverable:** Questions matched with policy evidence

### Phase 3: Frontend Integration
**Priority: HIGH | Time: 30 mins**

- [ ] Connect upload to `/api/analyze`
- [ ] Handle loading states
- [ ] Display real results
- [ ] Error handling

**Deliverable:** End-to-end working application

### Phase 4: Polish & Deploy
**Priority: MEDIUM | Time: 30 mins**

- [ ] Add progress indicators
- [ ] Error messages
- [ ] Deploy to Vercel
- [ ] Create GitHub repo
- [ ] Add README

**Deliverable:** Live URL + GitHub repo

---

## 8. Data Flow Diagram

```
User Uploads PDF
       │
       ▼
Frontend validates file
       │
       ▼
POST /api/analyze
       │
       ├──> Extract PDF text (pdf-parse)
       │
       ├──> Call DeepSeek: Extract questions
       │    Returns: List of questions
       │
       ├──> For each question:
       │    ├──> Call DeepSeek: Match policy
       │    └──> Determine status + evidence
       │
       ▼
Return JSON response
       │
       ▼
Frontend displays results
```

---

## 9. Sample Data Structure

### Example Request Processing

**Input PDF contains:**
```
1. Does the P&P state that the MCP must respond to
   retrospective requests no longer than 14 calendar days?

2. Are urgent authorizations processed within 72 hours?
```

**DeepSeek Extraction:**
```json
{
  "questions": [
    {
      "number": 1,
      "text": "Does the P&P state that the MCP must respond to retrospective requests no longer than 14 calendar days?"
    },
    {
      "number": 2,
      "text": "Are urgent authorizations processed within 72 hours?"
    }
  ]
}
```

**Evidence Matching (per question):**
```json
{
  "status": "met",
  "evidence": {
    "policyName": "Authorization and Processing of Referrals",
    "policyNumber": "GG.1508",
    "page": "10 of 25",
    "excerpt": "CalOptima Health shall complete...no later than fourteen (14) calendar days...",
    "confidence": 0.98
  }
}
```

---

## 10. Error Handling Strategy

### Upload Errors
- Invalid file type → 400 with message
- File too large → 413 with message
- Corrupted PDF → 400 with message

### Processing Errors
- DeepSeek API timeout → Retry once, then 500
- DeepSeek rate limit → 429 with retry-after
- PDF parse failure → 500 with details

### Client Display
- Show user-friendly error messages
- Provide retry option
- Log errors for debugging

---

## 11. Testing Strategy

### Unit Tests
- PDF text extraction
- DeepSeek API response parsing
- Question extraction logic

### Integration Tests
- Upload → Process → Display flow
- Error scenarios
- Edge cases (empty PDF, large PDF)

### Manual Testing
- Upload sample audit PDFs
- Verify question extraction accuracy
- Confirm evidence matching quality

---

## 12. Security Considerations

### File Upload
- Validate file type (PDF only)
- Limit file size (10MB max)
- Scan for malicious content (Vercel handles this)

### API Keys
- Store DeepSeek API key in environment variables
- Never expose in client code
- Use Vercel environment secrets

### Data Privacy
- Don't store uploaded PDFs
- Don't log sensitive policy content
- Process in-memory only

---

## 13. Performance Targets

| Metric | Target | Notes |
|--------|--------|-------|
| PDF Upload | < 5s | For typical 5MB file |
| Question Extraction | < 10s | For 20-30 questions |
| Evidence Matching | < 2s/question | Parallel processing |
| Total Processing | < 30s | For typical audit PDF |
| UI Responsiveness | < 100ms | React state updates |

---

## 14. Future Enhancements (Out of Scope)

- [ ] Policy database management UI
- [ ] Batch processing multiple PDFs
- [ ] Export results to Excel/PDF
- [ ] Historical audit tracking
- [ ] Multi-tenant support
- [ ] Real-time collaboration
- [ ] Advanced analytics dashboard

---

## 15. Dependencies

```json
{
  "production": [
    "next": "^16.0.0",
    "react": "^19.0.0",
    "pdf-parse": "^1.1.1",
    "openai": "^4.0.0"  // DeepSeek uses OpenAI SDK
  ],
  "development": [
    "typescript": "^5.0.0",
    "@types/node": "^20.0.0",
    "@types/react": "^19.0.0"
  ]
}
```

---

## 16. Deployment Checklist

- [ ] Environment variables configured (DEEPSEEK_API_KEY)
- [ ] Build passes without errors
- [ ] All tests passing
- [ ] README.md with setup instructions
- [ ] Live URL accessible
- [ ] GitHub repo created with clean commit history
- [ ] No hardcoded secrets in code

---

## 17. Success Metrics

### Functional Requirements
- ✅ PDF upload working
- ✅ Questions extracted accurately
- ✅ Evidence matched correctly
- ✅ Results displayed clearly

### Technical Requirements
- ✅ Clean, maintainable code
- ✅ TypeScript types throughout
- ✅ Error handling implemented
- ✅ Responsive UI design

### Deliverables
- ✅ Live deployed URL
- ✅ GitHub repository
- ✅ Clear documentation

---

**Document Version:** 1.0
**Last Updated:** 2025-11-05
**Author:** CTO (Claude Code)
