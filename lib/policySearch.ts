import { createClient } from '@supabase/supabase-js'
import OpenAI from 'openai'

const deepseek = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: 'https://api.deepseek.com/v1',
})

// Initialize Supabase client
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

interface PolicyMatch {
  policyName: string
  policyNumber: string
  page: string
  excerpt: string
  confidence: number
  category: string
}

interface SearchResult {
  status: 'met' | 'not-met' | 'under-review'
  evidence?: PolicyMatch
}

// Get policy documents from Supabase
interface PolicyDocument {
  id: string
  policy_number: string
  policy_name: string
  policy_category: string
  content: string
  file_size?: number
}

// Simple in-memory cache for policy analysis results
interface CachedResult {
  found: boolean
  excerpt?: string
  confidence?: number
  reasoning?: string
  pageNumber?: string
  timestamp: number
}

const policyAnalysisCache = new Map<string, CachedResult>()
const CACHE_TTL = 1000 * 60 * 60 // 1 hour cache lifetime

// Generate cache key from question and policy
function getCacheKey(question: string, policyId: string): string {
  // Use first 100 chars of question to create a reasonable cache key
  const questionKey = question.substring(0, 100).toLowerCase().trim()
  return `${questionKey}:${policyId}`
}

// Parse policy content into page chunks
interface PageChunk {
  pageNumber: string // e.g., "10 of 25"
  content: string
  startIndex: number
}

function parsePolicyIntoPages(content: string): PageChunk[] {
  // Look for "Page X of Y" markers
  const pageRegex = /Page (\d+) of (\d+)/gi
  const matches = Array.from(content.matchAll(pageRegex))

  if (matches.length === 0) {
    // No page markers found, return entire content as single chunk
    return [{
      pageNumber: '1',
      content: content,
      startIndex: 0
    }]
  }

  const chunks: PageChunk[] = []

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i]
    const pageNum = match[1]
    const totalPages = match[2]
    const startIndex = match.index || 0

    // Get content from this page marker to the next (or end of document)
    const nextMatch = matches[i + 1]
    const endIndex = nextMatch ? (nextMatch.index || content.length) : content.length
    const pageContent = content.substring(startIndex, endIndex)

    chunks.push({
      pageNumber: `${pageNum} of ${totalPages}`,
      content: pageContent,
      startIndex: startIndex
    })
  }

  return chunks
}

// Category descriptions for intelligent routing
const CATEGORY_DESCRIPTIONS = {
  AA: 'Administration - General administrative policies, glossaries, definitions',
  CMC: 'CalMediConnect - California-specific Medi-Cal and Medicare dual eligible programs',
  DD: 'Developmental Disabilities - Policies for members with developmental disabilities',
  EE: 'Eligibility & Enrollment - Member eligibility criteria, enrollment processes, disenrollment',
  FF: 'Financial - Billing, claims, payment, cost-sharing, copayments',
  GA: 'General Administration - Organizational structure, governance, compliance',
  GG: 'General - Broad range of general policies and procedures',
  HH: 'Health Services - Medical services, care coordination, hospice, palliative care, treatment authorization',
  MA: 'Medi-Cal - California Medicaid program policies, benefits, covered services',
  PA: 'Provider Administration - Provider network, credentialing, contracts, directory'
}

// Use AI to select relevant policy categories for a question
async function selectRelevantCategories(question: string): Promise<string[]> {
  try {
    const categoryList = Object.entries(CATEGORY_DESCRIPTIONS)
      .map(([code, desc]) => `${code}: ${desc}`)
      .join('\n')

    const selectionPrompt = `You are a healthcare compliance expert. Given an audit question, determine which policy categories are most likely to contain relevant answers.

Audit Question:
"${question}"

Available Policy Categories:
${categoryList}

Instructions:
- Select 1-3 categories most likely to contain the answer
- Return ONLY the category codes (e.g., ["HH", "MA"])
- Be strategic: choose categories that directly relate to the question topic
- Return ONLY valid JSON array, no additional text

Output Format:
["CODE1", "CODE2"]

Return JSON array only:`

    const response = await deepseek.chat.completions.create({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: 'You are a healthcare policy compliance expert.' },
        { role: 'user', content: selectionPrompt }
      ],
      temperature: 0.1,
      max_tokens: 100,
    })

    const content = response.choices[0]?.message?.content
    if (!content) return ['GG', 'HH', 'MA'] // Fallback to broad categories

    // Parse AI response
    let jsonContent = content.trim()
    if (jsonContent.startsWith('```json')) {
      jsonContent = jsonContent.replace(/```json\s*/, '').replace(/```\s*$/, '')
    } else if (jsonContent.startsWith('```')) {
      jsonContent = jsonContent.replace(/```\s*/, '').replace(/```\s*$/, '')
    }

    const categories = JSON.parse(jsonContent.trim())

    if (Array.isArray(categories) && categories.length > 0) {
      console.log(`🎯 AI selected categories: ${categories.join(', ')}`)
      return categories
    }

    return ['GG', 'HH', 'MA'] // Fallback
  } catch (error) {
    console.error('Error selecting categories:', error)
    return ['GG', 'HH', 'MA'] // Fallback to broad categories
  }
}

async function getAllPolicyDocuments(limit?: number, categories?: string[]): Promise<PolicyDocument[]> {
  try {
    let query = supabase
      .from('policy_documents')
      .select('id, policy_number, policy_name, policy_category, content, file_size')

    // Filter by categories if provided
    if (categories && categories.length > 0) {
      query = query.in('policy_category', categories)
    }

    query = query
      .order('policy_category', { ascending: true })
      .order('policy_number', { ascending: true })

    if (limit) {
      query = query.limit(limit)
    }

    const { data, error } = await query

    if (error) {
      console.error('Error fetching policies from Supabase:', error)
      return []
    }

    return data || []
  } catch (error) {
    console.error('Error in getAllPolicyDocuments:', error)
    return []
  }
}

// Search for evidence of a question in policy documents
export async function searchPoliciesForEvidence(
  question: string,
  maxPoliciesToSearch?: number
): Promise<SearchResult> {
  try {
    // Stage 1: Use AI to select relevant policy categories
    const selectedCategories = await selectRelevantCategories(question)

    // Stage 2: Get policy documents only from selected categories (no limit needed)
    const policies = await getAllPolicyDocuments(undefined, selectedCategories)

    if (policies.length === 0) {
      console.log('No policies found in selected categories')
      return { status: 'under-review' }
    }

    console.log(`Searching ${policies.length} policies from categories [${selectedCategories.join(', ')}]...`)

    // Helper function to process a single policy
    const processPolicy = async (policy: PolicyDocument) => {
      if (!policy.content || policy.content.length < 100) return null

      try {
        // Check cache first
        const cacheKey = getCacheKey(question, policy.id)
        const cached = policyAnalysisCache.get(cacheKey)

        if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
          // Use cached result
          if (cached.found && cached.confidence && cached.confidence > 0.6) {
            return {
              policy,
              result: cached
            }
          }
          return null
        }

        // Parse policy into page chunks
        const pageChunks = parsePolicyIntoPages(policy.content)

        // Search through pages until we find evidence
        for (const page of pageChunks) {
          // Limit page content to token limits
          const maxChars = 15000
          const pageContent = page.content.length > maxChars
            ? page.content.substring(0, maxChars) + '\n...(content truncated)'
            : page.content

          const searchPrompt = `You are a healthcare compliance expert. Analyze if this page from a policy document contains evidence that answers the audit question.

Audit Question:
"${question}"

Policy Document (${policy.policy_name}):
Page ${page.pageNumber}

${pageContent}

Instructions:
- Determine if this page contains specific evidence that answers the question
- If evidence is found, extract the EXACT relevant excerpt (max 250 characters)
- Rate your confidence (0.0 to 1.0)
- Return ONLY valid JSON, no additional text

Output Format:
{
  "found": true/false,
  "excerpt": "exact quote from policy if found",
  "confidence": 0.85,
  "reasoning": "brief explanation"
}

If no evidence found, return: {"found": false}
Return valid JSON only:`

          const response = await deepseek.chat.completions.create({
            model: 'deepseek-chat',
            messages: [
              { role: 'system', content: 'You are a healthcare policy compliance expert.' },
              { role: 'user', content: searchPrompt }
            ],
            temperature: 0.1,
            max_tokens: 1000,
          })

          const content = response.choices[0]?.message?.content
          if (!content) continue

          // Parse AI response
          let jsonContent = content.trim()
          if (jsonContent.startsWith('```json')) {
            jsonContent = jsonContent.replace(/```json\s*/, '').replace(/```\s*$/, '')
          } else if (jsonContent.startsWith('```')) {
            jsonContent = jsonContent.replace(/```\s*/, '').replace(/```\s*$/, '')
          }

          const result = JSON.parse(jsonContent.trim())

          if (result.found && result.confidence > 0.6) {
            // Cache the result with page information
            const cachedResult = {
              found: true,
              excerpt: result.excerpt,
              confidence: result.confidence,
              reasoning: result.reasoning,
              pageNumber: page.pageNumber,
              timestamp: Date.now()
            }

            policyAnalysisCache.set(cacheKey, cachedResult)

            return {
              policy,
              result: cachedResult
            }
          }
        }

        // No evidence found in any page, cache negative result
        policyAnalysisCache.set(cacheKey, {
          found: false,
          timestamp: Date.now()
        })

        return null
      } catch (e) {
        console.error('Error processing policy:', e)
        return null
      }
    }

    // Process policies in batches with early exit optimization
    const batchSize = 25 // Increased batch size for better throughput
    let policiesSearched = 0

    for (let i = 0; i < policies.length; i += batchSize) {
      const batch = policies.slice(i, i + batchSize)
      const batchNumber = Math.floor(i / batchSize) + 1
      const totalBatches = Math.ceil(policies.length / batchSize)

      console.log(`🔍 Processing batch ${batchNumber}/${totalBatches} (${batch.length} policies)...`)

      // Process entire batch in parallel
      const batchResults = await Promise.all(batch.map(processPolicy))
      policiesSearched += batch.length

      // Check if we found a match in this batch
      for (const match of batchResults) {
        if (match) {
          const pageInfo = match.result.pageNumber
            ? `Page ${match.result.pageNumber}`
            : 'Various'
          console.log(`✅ Found match in policy ${match.policy.policy_number} (${pageInfo}) after searching ${policiesSearched}/${policies.length} policies`)
          return {
            status: 'met',
            evidence: {
              policyName: match.policy.policy_name,
              policyNumber: match.policy.policy_number,
              page: pageInfo,
              excerpt: match.result.excerpt || 'Evidence found in policy document',
              confidence: match.result.confidence,
              category: match.policy.policy_category,
            }
          }
        }
      }
    }

    // If we searched through all policies and found nothing
    console.log(`❌ No matches found after searching all ${policiesSearched} policies`)
    return { status: 'not-met' }

  } catch (error) {
    console.error('Error searching policies:', error)
    return { status: 'under-review' }
  }
}

// Batch search for multiple questions (parallel processing for speed)
export async function searchPoliciesForQuestions(
  questions: { number: number; text: string }[],
  maxQuestionsToProcess: number
): Promise<Map<number, SearchResult>> {
  // Process a limited number of questions
  const questionsToProcess = questions.slice(0, maxQuestionsToProcess)

  console.log(`🚀 Processing ${questionsToProcess.length} questions in parallel...`)

  // Process all questions in parallel using Promise.all
  const searchPromises = questionsToProcess.map(async (question) => {
    console.log(`Searching for evidence for question ${question.number}...`)
    const result = await searchPoliciesForEvidence(question.text) // AI selects relevant categories automatically
    return { questionNumber: question.number, result }
  })

  // Wait for all questions to finish processing
  const searchResults = await Promise.all(searchPromises)

  // Convert array results back to Map
  const results = new Map<number, SearchResult>()
  for (const { questionNumber, result } of searchResults) {
    results.set(questionNumber, result)
  }

  console.log(`✅ Completed processing ${questionsToProcess.length} questions`)

  return results
}
