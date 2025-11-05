"use client"

import type React from "react"

import { useState } from "react"
import { Upload, FileText, CheckCircle2, XCircle, Clock, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Spinner } from "@/components/ui/spinner"

type ComplianceStatus = "met" | "not-met" | "under-review"

interface Evidence {
  policyName: string
  policyNumber: string
  page: string
  excerpt: string
}

interface AuditQuestion {
  id: string
  number: number
  text: string
  status: ComplianceStatus
  evidence?: Evidence
}

// Real data will be fetched from the API

export default function ComplianceAuditPage() {
  const [uploadedFile, setUploadedFile] = useState<File | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [questions, setQuestions] = useState<AuditQuestion[]>([])
  const [isDragging, setIsDragging] = useState(false)

  const handleFileUpload = async (file: File) => {
    if (file.type === "application/pdf") {
      setUploadedFile(file)
      setIsProcessing(true)

      try {
        // Create form data
        const formData = new FormData()
        formData.append('file', file)

        // Call the API
        const response = await fetch('/api/analyze', {
          method: 'POST',
          body: formData,
        })

        const result = await response.json()

        if (result.success) {
          setQuestions(result.questions)
        } else {
          // Handle error
          console.error('Error:', result.error)
          alert(`Error: ${result.error || 'Failed to process PDF'}`)
        }
      } catch (error) {
        console.error('Upload error:', error)
        alert('Failed to upload file. Please try again.')
      } finally {
        setIsProcessing(false)
      }
    } else {
      alert('Please upload a PDF file.')
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFileUpload(file)
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }

  const handleDragLeave = () => {
    setIsDragging(false)
  }

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleFileUpload(file)
  }

  const handleReset = () => {
    setUploadedFile(null)
    setQuestions([])
    setIsProcessing(false)
  }

  const getStatusIcon = (status: ComplianceStatus) => {
    switch (status) {
      case "met":
        return <CheckCircle2 className="h-5 w-5 text-success" />
      case "not-met":
        return <XCircle className="h-5 w-5 text-destructive" />
      case "under-review":
        return <Clock className="h-5 w-5 text-warning" />
    }
  }

  const getStatusBadge = (status: ComplianceStatus) => {
    switch (status) {
      case "met":
        return <Badge className="bg-success text-success-foreground">Requirement Met</Badge>
      case "not-met":
        return <Badge className="bg-destructive text-destructive-foreground">Not Met</Badge>
      case "under-review":
        return <Badge className="bg-warning text-warning-foreground">Under Review</Badge>
    }
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card">
        <div className="container mx-auto px-4 py-6 md:py-8">
          <h1 className="text-3xl md:text-4xl font-bold text-foreground text-balance">
            Healthcare Compliance Audit Assistant
          </h1>
          <p className="mt-2 text-muted-foreground text-lg">Automated Policy Evidence Matching</p>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 md:py-12">
        {/* Upload Section */}
        {!uploadedFile && !isProcessing && questions.length === 0 && (
          <Card className="max-w-3xl mx-auto">
            <CardHeader>
              <CardTitle>Upload Audit Questions</CardTitle>
              <CardDescription>
                Upload a PDF containing audit questions to automatically match them with policy evidence
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                className={`
                  border-2 border-dashed rounded-lg p-12 text-center transition-colors
                  ${isDragging ? "border-primary bg-accent" : "border-border hover:border-primary hover:bg-accent/50"}
                `}
              >
                <Upload className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                <h3 className="text-lg font-semibold mb-2">Drag and drop your PDF here</h3>
                <p className="text-sm text-muted-foreground mb-4">or click to browse files</p>
                <input
                  type="file"
                  accept="application/pdf"
                  onChange={handleFileInput}
                  className="hidden"
                  id="file-upload"
                />
                <label htmlFor="file-upload">
                  <Button asChild>
                    <span>Select PDF File</span>
                  </Button>
                </label>
                <p className="text-xs text-muted-foreground mt-4">PDF files only • Maximum size 10MB</p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Loading State */}
        {isProcessing && (
          <Card className="max-w-3xl mx-auto">
            <CardContent className="py-12">
              <div className="flex flex-col items-center gap-4">
                <Spinner className="h-12 w-12 text-primary" />
                <p className="text-lg font-medium">Analyzing audit questions...</p>
                <p className="text-sm text-muted-foreground">Extracting questions and matching with policy evidence</p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Results Section */}
        {questions.length > 0 && !isProcessing && (
          <div className="space-y-6">
            {/* File Info Bar */}
            <Card>
              <CardContent className="py-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <FileText className="h-5 w-5 text-primary" />
                    <div>
                      <p className="font-medium">{uploadedFile?.name}</p>
                      <p className="text-sm text-muted-foreground">{questions.length} questions analyzed</p>
                    </div>
                  </div>
                  <Button variant="outline" size="sm" onClick={handleReset}>
                    <X className="h-4 w-4 mr-2" />
                    Upload New File
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Questions List */}
            <div className="space-y-4">
              {questions.map((question) => (
                <Collapsible key={question.id} defaultOpen={question.status === "met"}>
                  <Card>
                    <CollapsibleTrigger className="w-full">
                      <CardHeader className="hover:bg-accent/50 transition-colors">
                        <div className="flex items-start gap-4 text-left">
                          <div className="mt-1">{getStatusIcon(question.status)}</div>
                          <div className="flex-1 space-y-2">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-mono text-muted-foreground">
                                Question #{question.number}
                              </span>
                              {getStatusBadge(question.status)}
                            </div>
                            <p className="text-base font-medium leading-relaxed">{question.text}</p>
                          </div>
                        </div>
                      </CardHeader>
                    </CollapsibleTrigger>

                    {question.evidence && (
                      <CollapsibleContent>
                        <CardContent className="pt-0">
                          <div className="ml-9 pl-4 border-l-2 border-success space-y-3">
                            <div>
                              <h4 className="text-sm font-semibold text-muted-foreground mb-1">Evidence</h4>
                              <p className="font-medium">{question.evidence.policyName}</p>
                              <p className="text-sm text-muted-foreground">
                                Policy: {question.evidence.policyNumber} • Page {question.evidence.page}
                              </p>
                            </div>
                            <div className="bg-accent rounded-md p-4">
                              <p className="text-sm leading-relaxed">"{question.evidence.excerpt}"</p>
                            </div>
                          </div>
                        </CardContent>
                      </CollapsibleContent>
                    )}

                    {!question.evidence && (
                      <CollapsibleContent>
                        <CardContent className="pt-0">
                          <div className="ml-9 pl-4 border-l-2 border-muted">
                            <p className="text-sm text-muted-foreground">
                              {question.status === "under-review"
                                ? "This requirement is currently under review. Additional documentation may be needed."
                                : "No matching policy evidence found. This requirement may need attention."}
                            </p>
                          </div>
                        </CardContent>
                      </CollapsibleContent>
                    )}
                  </Card>
                </Collapsible>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
