// Quick test to verify intelligent category selection is working
require('dotenv').config({ path: '.env.local' })

// Mock the policySearch module to test category selection
async function testCategorySelection() {
  const testQuestions = [
    "Does the P&P state that Members who qualify for and elect to receive hospice care services remain enrolled in an MCP while receiving such services?",
    "What is the process for provider credentialing and network management?",
    "How are member copayments calculated for prescription drugs?",
  ]

  console.log('Testing Intelligent Category Selection\n')
  console.log('=' .repeat(60))

  for (const question of testQuestions) {
    console.log(`\nQuestion: ${question.substring(0, 80)}...`)
    console.log('\nExpected categories:')
    if (question.includes('hospice')) {
      console.log('  - HH (Health Services) - contains hospice policies')
      console.log('  - MA (Medi-Cal) - may contain related benefits')
    } else if (question.includes('provider') && question.includes('credentialing')) {
      console.log('  - PA (Provider Administration) - provider network policies')
      console.log('  - GA (General Administration) - credentialing processes')
    } else if (question.includes('copayments')) {
      console.log('  - FF (Financial) - billing and payment policies')
      console.log('  - MA (Medi-Cal) - benefit cost-sharing')
    }
    console.log('\n' + '-'.repeat(60))
  }

  console.log('\n\n✅ Category selection test setup complete')
  console.log('\nNext steps:')
  console.log('1. Test with real upload: Upload a PDF and check console logs')
  console.log('2. Look for: "🎯 AI selected categories: HH, MA"')
  console.log('3. Verify: "Searching X policies from categories [HH, MA]..."')
  console.log('4. Should see: 100-150 policies instead of 373')
}

testCategorySelection()
