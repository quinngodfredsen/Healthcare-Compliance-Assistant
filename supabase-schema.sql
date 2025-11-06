-- Healthcare Compliance Database Schema
-- Run this in Supabase SQL Editor: https://supabase.com/dashboard/project/ljhfhhvaxklmkotzwsmz/sql

-- Enable pgvector extension for semantic search
CREATE EXTENSION IF NOT EXISTS vector;

-- Table to store policy documents
CREATE TABLE policy_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_number TEXT NOT NULL,           -- e.g., "GG.1100"
  policy_name TEXT NOT NULL,             -- full filename
  policy_category TEXT NOT NULL,         -- e.g., "GG", "AA"
  content TEXT NOT NULL,                 -- full extracted text
  content_embedding vector(1536),        -- OpenAI embedding for semantic search
  page_count INTEGER,
  file_size INTEGER,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for fast lookups
CREATE INDEX idx_policy_number ON policy_documents(policy_number);
CREATE INDEX idx_category ON policy_documents(policy_category);

-- Index for vector similarity search (for future semantic search)
CREATE INDEX ON policy_documents USING ivfflat (content_embedding vector_cosine_ops);

-- Add comment to table
COMMENT ON TABLE policy_documents IS 'Stores healthcare policy documents with extracted text content for compliance checking';
