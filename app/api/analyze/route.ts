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

    // Phase 1: Extract questions using DeepSeek with parallel processing
    console.log('Extracting questions with DeepSeek (parallel processing)...')

    // Split PDF text into chunks with OVERLAP to catch questions split across boundaries
    const CHUNK_SIZE = 3000 // Larger chunks for better context
    const OVERLAP = 800 // Overlap ensures split questions are caught by multiple chunks
    const chunks: string[] = []
    for (let i = 0; i < pdfText.length; i += CHUNK_SIZE - OVERLAP) {
      const end = Math.min(i + CHUNK_SIZE, pdfText.length)
      chunks.push(pdfText.slice(i, end))
      if (end >= pdfText.length) break
    }

    console.log(`Split into ${chunks.length} chunks for parallel processing`)

    // Process all chunks in parallel
    const chunkPromises = chunks.map(async (chunk, index) => {
      const extractionPrompt = `You are an expert healthcare compliance analyst. Extract all audit questions from the provided PDF text chunk.

PDF Text Chunk ${index + 1}:
${chunk}

Instructions:
- Extract ALL compliance questions from this text chunk
- Preserve exact wording of each question
- Preserve the ORIGINAL question number from the document (do NOT renumber)
- Return ONLY valid JSON, no additional text
- Include partial questions if they appear at chunk boundaries

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

      const stream = await deepseek.chat.completions.create({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: 'You are a healthcare compliance expert that extracts audit questions from documents.' },
          { role: 'user', content: extractionPrompt }
        ],
        temperature: 0.1,
        max_tokens: 4096,
        stream: true,
      })

      let extractedContent = ''
      for await (const streamChunk of stream) {
        const content = streamChunk.choices[0]?.delta?.content
        if (content) {
          extractedContent += content
        }
      }

      if (!extractedContent) {
        throw new Error(`No response from DeepSeek for chunk ${index + 1}`)
      }

      return { index, content: extractedContent }
    })

    // Wait for all chunks to complete
    const chunkResults = await Promise.all(chunkPromises)

    // Combine all extracted questions from chunks
    let allExtractedQuestions: { number: number; text: string }[] = []
    for (const result of chunkResults.sort((a, b) => a.index - b.index)) {
      try {
        let jsonContent = result.content.trim()
        if (jsonContent.startsWith('```json')) {
          jsonContent = jsonContent.replace(/```json\s*/, '').replace(/```\s*$/, '')
        } else if (jsonContent.startsWith('```')) {
          jsonContent = jsonContent.replace(/```\s*/, '').replace(/```\s*$/, '')
        }

        const parsed = JSON.parse(jsonContent.trim())
        const questions = parsed.questions || []
        allExtractedQuestions = allExtractedQuestions.concat(questions)
      } catch (e) {
        console.error(`Failed to parse chunk ${result.index}:`, result.content)
        // Continue with other chunks
      }
    }

    // Deduplicate by question number (overlapping chunks may extract same question multiple times)
    // Keep the longest/most complete version of each question
    const questionMap = new Map<number, { text: string; length: number }>()

    for (const q of allExtractedQuestions) {
      const existing = questionMap.get(q.number)

      if (!existing) {
        // First time seeing this question number
        questionMap.set(q.number, { text: q.text, length: q.text.length })
      } else {
        // Already have this question - keep the longer/more complete version
        if (q.text.length > existing.length) {
          questionMap.set(q.number, { text: q.text, length: q.text.length })
        }
      }
    }

    // Convert to array and sort by question number
    const extractedQuestions = Array.from(questionMap.entries())
      .map(([number, data]) => ({ number, text: data.text }))
      .sort((a, b) => a.number - b.number)

    console.log(`Extracted ${allExtractedQuestions.length} questions from ${chunks.length} chunks, deduplicated to ${extractedQuestions.length} unique questions`)

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
