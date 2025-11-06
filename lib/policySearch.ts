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

async function getAllPolicyDocuments(limit?: number): Promise<PolicyDocument[]> {
  try {
    let query = supabase
      .from('policy_documents')
      .select('id, policy_number, policy_name, policy_category, content, file_size')
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
  maxPoliciesToSearch: number = 50
): Promise<SearchResult> {
  try {
    // Get policy documents from Supabase
    const policies = await getAllPolicyDocuments(maxPoliciesToSearch)

    if (policies.length === 0) {
      console.log('No policies found in database')
      return { status: 'under-review' }
    }

    console.log(`Searching ${policies.length} policies from Supabase for question...`)

    // Search through each policy
    for (const policy of policies) {
      if (!policy.content || policy.content.length < 100) continue

      // Use AI to check if this policy contains evidence for the question
      // We'll search in chunks to avoid token limits
      const maxChars = 15000 // Keep within token limits
      const policyChunk = policy.content.substring(0, maxChars)

      const searchPrompt = `You are a healthcare compliance expert. Analyze if this policy document contains evidence that answers the audit question.

Audit Question:
"${question}"

Policy Document (${policy.policy_name}):
${policyChunk}

Instructions:
- Determine if this policy contains specific evidence that answers the question
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

      try {
        // Parse AI response
        let jsonContent = content.trim()
        if (jsonContent.startsWith('```json')) {
          jsonContent = jsonContent.replace(/```json\s*/, '').replace(/```\s*$/, '')
        } else if (jsonContent.startsWith('```')) {
          jsonContent = jsonContent.replace(/```\s*/, '').replace(/```\s*$/, '')
        }

        const result = JSON.parse(jsonContent.trim())

        if (result.found && result.confidence > 0.6) {
          return {
            status: 'met',
            evidence: {
              policyName: policy.policy_name,
              policyNumber: policy.policy_number,
              page: 'Various', // Could enhance to find specific page
              excerpt: result.excerpt || 'Evidence found in policy document',
              confidence: result.confidence,
              category: policy.policy_category,
            }
          }
        }
      } catch (e) {
        console.error('Error parsing AI response:', e)
        continue
      }
    }

    // If we searched through policies and found nothing
    return { status: 'not-met' }

  } catch (error) {
    console.error('Error searching policies:', error)
    return { status: 'under-review' }
  }
}

// Batch search for multiple questions (more efficient)
export async function searchPoliciesForQuestions(
  questions: { number: number; text: string }[],
  maxQuestionsToProcess: number = 10
): Promise<Map<number, SearchResult>> {
  const results = new Map<number, SearchResult>()

  // Process a limited number of questions
  const questionsToProcess = questions.slice(0, maxQuestionsToProcess)

  for (const question of questionsToProcess) {
    console.log(`Searching for evidence for question ${question.number}...`)
    const result = await searchPoliciesForEvidence(question.text, 20) // Limit to 20 policies per question
    results.set(question.number, result)
  }

  return results
}
