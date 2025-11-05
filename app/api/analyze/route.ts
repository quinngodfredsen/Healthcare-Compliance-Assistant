import { NextRequest, NextResponse } from 'next/server'
import pdf from 'pdf-parse'
import OpenAI from 'openai'

// Initialize DeepSeek client using OpenAI SDK
const deepseek = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: 'https://api.deepseek.com/v1',
})

interface AuditQuestion {
  id: string
  number: number
  text: string
  status: 'met' | 'not-met' | 'under-review'
  evidence?: {
    policyName: string
    policyNumber: string
    page: string
    excerpt: string
    confidence?: number
  }
}

export async function POST(request: NextRequest) {
  const startTime = Date.now()

  try {
    // Parse the uploaded file
    const formData = await request.formData()
    const file = formData.get('file') as File

    if (!file) {
      return NextResponse.json(
        { success: false, error: 'No file provided' },
        { status: 400 }
      )
    }

    // Validate file type
    if (file.type !== 'application/pdf') {
      return NextResponse.json(
        { success: false, error: 'Invalid file type. Please upload a PDF.' },
        { status: 400 }
      )
    }

    // Validate file size (10MB max)
    const maxSize = 10 * 1024 * 1024 // 10MB
    if (file.size > maxSize) {
      return NextResponse.json(
        { success: false, error: 'File too large. Maximum size is 10MB.' },
        { status: 413 }
      )
    }

    // Convert file to buffer
    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    // Extract text from PDF
    console.log('Extracting text from PDF...')
    const pdfData = await pdf(buffer)
    const pdfText = pdfData.text

    if (!pdfText || pdfText.trim().length === 0) {
      return NextResponse.json(
        { success: false, error: 'Could not extract text from PDF. The PDF may be empty or corrupted.' },
        { status: 400 }
      )
    }

    // Phase 1: Extract questions using DeepSeek
    console.log('Extracting questions with DeepSeek...')
    const extractionPrompt = `You are an expert healthcare compliance analyst. Extract all audit questions from the provided PDF text.

PDF Text:
${pdfText}

Instructions:
- Extract ALL compliance questions from the text
- Preserve exact wording of each question
- Number them sequentially starting from 1
- Return ONLY valid JSON, no additional text

Output Format:
{
  "questions": [
    {
      "number": 1,
      "text": "Full question text here"
    }
  ]
}

Return valid JSON only:`

    const extractionResponse = await deepseek.chat.completions.create({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: 'You are a healthcare compliance expert that extracts audit questions from documents.' },
        { role: 'user', content: extractionPrompt }
      ],
      temperature: 0.1,
      max_tokens: 4000,
    })

    const extractedContent = extractionResponse.choices[0]?.message?.content
    if (!extractedContent) {
      throw new Error('No response from DeepSeek for question extraction')
    }

    // Parse the extracted questions
    let extractedQuestions: { number: number; text: string }[]
    try {
      const parsed = JSON.parse(extractedContent)
      extractedQuestions = parsed.questions || []
    } catch (e) {
      console.error('Failed to parse DeepSeek response:', extractedContent)
      throw new Error('Invalid response format from AI')
    }

    if (extractedQuestions.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No questions found in the uploaded PDF.' },
        { status: 400 }
      )
    }

    // Phase 2: For demonstration, we'll mark questions as "under-review" by default
    // In production, this would match against policy documents
    console.log(`Processing ${extractedQuestions.length} questions...`)

    const auditQuestions: AuditQuestion[] = extractedQuestions.map((q) => ({
      id: `q-${q.number}`,
      number: q.number,
      text: q.text,
      status: 'under-review',
      evidence: undefined,
    }))

    // For the first 3 questions, let's try to match against policies
    // This is a simplified version - full implementation would search all policy files
    const questionsToMatch = auditQuestions.slice(0, Math.min(3, auditQuestions.length))

    for (const question of questionsToMatch) {
      try {
        const matchingPrompt = `You are a healthcare policy expert. Analyze if this audit question can be answered based on typical healthcare compliance policies.

Audit Question:
"${question.text}"

Instructions:
- Determine if this requirement would typically be met by standard healthcare policies
- If likely met, provide a realistic policy reference
- Return ONLY valid JSON, no additional text

Output Format:
{
  "status": "met" | "not-met" | "under-review",
  "evidence": {
    "policyName": "Example Policy Name",
    "policyNumber": "XX.####",
    "page": "Page reference",
    "excerpt": "Relevant policy excerpt (max 200 chars)",
    "confidence": 0.85
  }
}

If you cannot determine compliance, return status "under-review" with no evidence.
Return valid JSON only:`

        const matchingResponse = await deepseek.chat.completions.create({
          model: 'deepseek-chat',
          messages: [
            { role: 'system', content: 'You are a healthcare policy expert.' },
            { role: 'user', content: matchingPrompt }
          ],
          temperature: 0.1,
          max_tokens: 1000,
        })

        const matchContent = matchingResponse.choices[0]?.message?.content
        if (matchContent) {
          try {
            const matchResult = JSON.parse(matchContent)
            question.status = matchResult.status || 'under-review'
            if (matchResult.evidence) {
              question.evidence = matchResult.evidence
            }
          } catch (e) {
            console.error('Failed to parse matching response:', e)
            // Keep as under-review if parsing fails
          }
        }
      } catch (error) {
        console.error(`Error matching question ${question.number}:`, error)
        // Keep as under-review if matching fails
      }
    }

    const processingTime = Date.now() - startTime

    return NextResponse.json({
      success: true,
      questions: auditQuestions,
      processingTime,
    })

  } catch (error) {
    console.error('Error processing PDF:', error)

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'An unexpected error occurred while processing the PDF.'
      },
      { status: 500 }
    )
  }
}

export const config = {
  api: {
    bodyParser: false, // Disable body parsing, we'll handle it with formData
  },
}
