import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'
import { searchPoliciesForQuestions } from '@/lib/policySearch'

// Initialize DeepSeek client using OpenAI SDK
const deepseek = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: 'https://api.deepseek.com/v1',
})

// PDF parsing with unpdf (reliable server-side library)
async function parsePDF(buffer: Buffer): Promise<string> {
  const { extractText } = await import('unpdf')

  // Convert buffer to Uint8Array
  const uint8Array = new Uint8Array(buffer)

  // Extract text from PDF
  const { text } = await extractText(uint8Array, {
    mergePages: true,
  })

  return text
}

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
    const pdfText = await parsePDF(buffer)

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
      max_tokens: 8192,
    })

    const extractedContent = extractionResponse.choices[0]?.message?.content
    if (!extractedContent) {
      throw new Error('No response from DeepSeek for question extraction')
    }

    // Parse the extracted questions
    let extractedQuestions: { number: number; text: string }[]
    try {
      // Strip markdown code blocks if present
      let jsonContent = extractedContent.trim()
      if (jsonContent.startsWith('```json')) {
        jsonContent = jsonContent.replace(/```json\s*/, '').replace(/```\s*$/, '')
      } else if (jsonContent.startsWith('```')) {
        jsonContent = jsonContent.replace(/```\s*/, '').replace(/```\s*$/, '')
      }

      const parsed = JSON.parse(jsonContent.trim())
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

    // Phase 2: Search through actual policy documents for evidence
    console.log(`Processing ${extractedQuestions.length} questions...`)
    console.log('Searching policy documents for evidence...')

    // Initialize all questions as under-review
    const auditQuestions: AuditQuestion[] = extractedQuestions.map((q) => ({
      id: `q-${q.number}`,
      number: q.number,
      text: q.text,
      status: 'under-review',
      evidence: undefined,
    }))

    // Search through policy documents for the first 10 questions
    // (Searching all 373 policies for all questions would be slow)
    const searchResults = await searchPoliciesForQuestions(extractedQuestions, 10)

    // Update questions with search results
    for (const question of auditQuestions) {
      const result = searchResults.get(question.number)
      if (result) {
        question.status = result.status
        if (result.evidence) {
          question.evidence = {
            policyName: result.evidence.policyName,
            policyNumber: result.evidence.policyNumber,
            page: result.evidence.page,
            excerpt: result.evidence.excerpt,
            confidence: result.evidence.confidence,
          }
        }
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

// Note: Body parser is automatically disabled for formData in Next.js App Router
