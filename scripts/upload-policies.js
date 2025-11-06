/**
 * Upload Policy PDFs to Supabase
 *
 * This script extracts text from all policy PDFs and uploads them to Supabase.
 * Run with: node scripts/upload-policies.js
 */

const { extractText } = require('unpdf');
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: '.env.local' });

// Initialize Supabase
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

async function uploadPolicies() {
  const policiesDir = path.join(__dirname, '..', 'public', 'policies');

  // Check if policies directory exists
  if (!fs.existsSync(policiesDir)) {
    console.error('❌ Error: policies directory not found at:', policiesDir);
    console.error('Please ensure /public/policies exists with policy PDFs');
    return;
  }

  const categories = fs.readdirSync(policiesDir);
  let totalProcessed = 0;
  let totalErrors = 0;

  console.log('🚀 Starting policy upload to Supabase...\n');

  for (const category of categories) {
    // Skip hidden files and non-directories
    if (category.startsWith('.') || !fs.statSync(path.join(policiesDir, category)).isDirectory()) {
      continue;
    }

    const categoryPath = path.join(policiesDir, category);
    const files = fs.readdirSync(categoryPath);

    console.log(`📁 Processing category: ${category} (${files.filter(f => f.endsWith('.pdf')).length} files)`);

    for (const file of files) {
      if (!file.endsWith('.pdf')) continue;

      try {
        console.log(`   Processing ${file}...`);

        // Extract text from PDF
        const filePath = path.join(categoryPath, file);
        const buffer = fs.readFileSync(filePath);
        const { text } = await extractText(new Uint8Array(buffer), { mergePages: true });

        // Extract policy number (e.g., GG.1100)
        const policyNumberMatch = file.match(/^([A-Z]+\\.\\d+)/);
        const policyNumber = policyNumberMatch ? policyNumberMatch[1] : file;

        // Check if already exists
        const { data: existing } = await supabase
          .from('policy_documents')
          .select('id')
          .eq('policy_number', policyNumber)
          .eq('policy_category', category)
          .single();

        if (existing) {
          console.log(`   ⏭️  Skipped ${file} (already exists)`);
          continue;
        }

        // Insert into Supabase
        const { error } = await supabase
          .from('policy_documents')
          .insert({
            policy_number: policyNumber,
            policy_name: file.replace('.pdf', ''),
            policy_category: category,
            content: text,
            file_size: buffer.length,
            page_count: null // unpdf doesn't provide page count easily
          });

        if (error) {
          console.error(`   ❌ Error uploading ${file}:`, error.message);
          totalErrors++;
        } else {
          console.log(`   ✓ Uploaded ${file}`);
          totalProcessed++;
        }
      } catch (error) {
        console.error(`   ❌ Error processing ${file}:`, error.message);
        totalErrors++;
      }
    }

    console.log(''); // Empty line between categories
  }

  console.log('═'.repeat(60));
  console.log(`✅ Upload complete!`);
  console.log(`   Successfully uploaded: ${totalProcessed} policies`);
  if (totalErrors > 0) {
    console.log(`   Errors: ${totalErrors} policies`);
  }
  console.log('═'.repeat(60));
}

// Run the upload
uploadPolicies().catch(console.error);
