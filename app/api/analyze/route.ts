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

    // Two-Pass Extraction: Fast and accurate
    console.log('Phase 1: Scanning for question boundaries...')

    // PASS 1: Quick scan to identify question boundaries (fast, low token output)
    const scanPrompt = `You are an expert healthcare compliance analyst. Quickly scan this PDF text and identify all question boundaries.

PDF Text:
${pdfText}

Instructions:
- Find all question numbers (e.g., "1.", "2.", "3.")
- For each question, provide the question number and the first 20-30 words
- This is just a boundary scan - don't extract full questions yet
- Return ONLY valid JSON, no additional text

Output Format:
{
  "questionBoundaries": [
    {
      "number": 1,
      "startText": "First 20-30 words of question..."
    }
  ]
}

Return valid JSON only:`

    const scanResponse = await deepseek.chat.completions.create({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: 'You are a healthcare compliance expert that identifies question boundaries in documents.' },
        { role: 'user', content: scanPrompt }
      ],
      temperature: 0.1,
      max_tokens: 2048, // Low since we're just getting boundaries
    })

    const scanContent = scanResponse.choices[0]?.message?.content
    if (!scanContent) {
      throw new Error('No response from DeepSeek for boundary scan')
    }

    // Parse question boundaries
    let questionBoundaries: { number: number; startText: string }[] = []
    try {
      let jsonContent = scanContent.trim()
      if (jsonContent.startsWith('```json')) {
        jsonContent = jsonContent.replace(/```json\s*/, '').replace(/```\s*$/, '')
      } else if (jsonContent.startsWith('```')) {
        jsonContent = jsonContent.replace(/```\s*/, '').replace(/```\s*$/, '')
      }

      const parsed = JSON.parse(jsonContent.trim())
      questionBoundaries = parsed.questionBoundaries || []
    } catch (e) {
      console.error('Failed to parse boundary scan:', scanContent)
      throw new Error('Invalid response format from AI during boundary scan')
    }

    console.log(`Found ${questionBoundaries.length} question boundaries`)
    console.log('Phase 2: Extracting questions in parallel...')

    // PASS 2: Extract each individual question in parallel (fast because parallel)
    const extractionPromises = questionBoundaries.map(async (boundary) => {
      // Find the text section for this question
      const questionNumberPattern = new RegExp(`${boundary.number}\\.\\s+`, 'i')
      const nextNumberPattern = new RegExp(`${boundary.number + 1}\\.\\s+`, 'i')

      const startIndex = pdfText.search(questionNumberPattern)
      const endIndex = pdfText.search(nextNumberPattern)

      const questionText = endIndex > startIndex
        ? pdfText.slice(startIndex, endIndex).trim()
        : pdfText.slice(startIndex).trim()

      const extractPrompt = `Extract the full compliance question from this text. Return only the question text, cleaned up.

Text:
${questionText.slice(0, 3000)}

Return only the complete question text, nothing else:`

      const response = await deepseek.chat.completions.create({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: 'You extract and clean up compliance question text.' },
          { role: 'user', content: extractPrompt }
        ],
        temperature: 0.1,
        max_tokens: 512, // Small since it's just one question
      })

      const extractedText = response.choices[0]?.message?.content?.trim() || questionText

      return {
        number: boundary.number,
        text: extractedText
      }
    })

    // Wait for all extractions to complete
    const extractedQuestions = await Promise.all(extractionPromises)

    console.log(`Extracted ${extractedQuestions.length} questions in parallel`)

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

    // Search through policy documents for all questions
    // With optimizations (early exit, caching, AI category selection), this is now feasible
    const searchResults = await searchPoliciesForQuestions(extractedQuestions, extractedQuestions.length)

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
