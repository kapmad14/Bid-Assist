// app/(authenticated)/help/page.tsx
'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  HelpCircle,
  LifeBuoy,
  MessageCircle,
  Mail,
  BookOpen,
  AlertTriangle,
  ArrowRight,
} from 'lucide-react';

export default function HelpSupportPage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [resultMsg, setResultMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setResultMsg(null);
    setErrorMsg(null);

    if (!name || !email || !subject || !message) {
      setErrorMsg('Please fill all fields.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/support', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, subject, message }),
      });

      const data = await res.json();
      if (!res.ok || !data?.success) {
        setErrorMsg(data?.error || 'Failed to submit request');
      } else {
        setResultMsg('Support request submitted. We will get back to you shortly.');
        // clear form
        setName('');
        setEmail('');
        setSubject('');
        setMessage('');
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Network error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top bar */}
      <div className="bg-white border-b-2 border-gray-200 px-4 py-4 shadow-sm">
        <div className="container mx-auto flex items-center justify-between">
          <h1 className="text-xl font-bold text-gray-900">Help &amp; Support</h1>
        </div>
      </div>

      <div className="container mx-auto px-4 py-6 space-y-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left column */}
          <div className="lg:col-span-2 space-y-4">
            <Card className="border-2 border-gray-200">
              <CardHeader className="flex flex-row items-center justify-between space-y-0">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-[#F7C846] flex items-center justify-center shadow-sm">
                    <HelpCircle className="h-5 w-5 text-black" />
                  </div>
                  <div>
                    <CardTitle className="text-base font-bold text-gray-900">
                      Need help with a tender?
                    </CardTitle>
                    <p className="text-xs text-gray-600 mt-1">
                      Fill out the form below and we’ll get back to you as soon as possible.
                    </p>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="space-y-4 text-sm text-gray-800">
                <form className="space-y-6" onSubmit={handleSubmit}>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="flex flex-col">
                      <label className="font-semibold text-gray-900 mb-1">Name</label>
                      <input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        name="name"
                        type="text"
                        placeholder="Your name"
                        className="
                          w-full rounded-lg border border-gray-300 bg-white px-3 py-2
                          text-gray-900 shadow-sm focus:outline-none
                          focus:ring-2 focus:ring-[#F7C846]
                        "
                      />
                    </div>

                    <div className="flex flex-col">
                      <label className="font-semibold text-gray-900 mb-1">Email</label>
                      <input
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        name="email"
                        type="email"
                        placeholder="you@example.com"
                        className="
                          w-full rounded-lg border border-gray-300 bg-white px-3 py-2
                          text-gray-900 shadow-sm focus:outline-none
                          focus:ring-2 focus:ring-[#F7C846]
                        "
                      />
                    </div>
                  </div>

                  <div className="flex flex-col">
                    <label className="font-semibold text-gray-900 mb-1">Subject</label>
                    <input
                      value={subject}
                      onChange={(e) => setSubject(e.target.value)}
                      name="subject"
                      type="text"
                      placeholder="Brief description of your issue"
                      className="
                        w-full rounded-lg border border-gray-300 bg-white px-3 py-2
                        text-gray-900 shadow-sm focus:outline-none
                        focus:ring-2 focus:ring-[#F7C846]
                      "
                    />
                  </div>

                  <div className="flex flex-col">
                    <label className="font-semibold text-gray-900 mb-1">Message</label>
                    <textarea
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      name="message"
                      rows={6}
                      placeholder="Please describe your issue in detail. Include any relevant info."
                      className="
                        w-full rounded-lg border border-gray-300 bg-white px-3 py-2
                        text-gray-900 shadow-sm focus:outline-none resize-none
                        focus:ring-2 focus:ring-[#F7C846]
                      "
                    />
                  </div>

                  {errorMsg && (
                    <div className="text-sm text-red-600 font-medium">
                      {errorMsg}
                    </div>
                  )}
                  {resultMsg && (
                    <div className="text-sm text-green-600 font-medium">
                      {resultMsg}
                    </div>
                  )}

                  <div className="flex justify-end">
                    <Button
                      type="submit"
                      className="
                        bg-[#F7C846] hover:bg-[#e5b53d] text-[#0E121A]
                        font-bold rounded-full py-3 px-6 shadow-md shadow-gray-300/40
                      "
                      disabled={loading}
                    >
                      {loading ? 'Submitting...' : 'Submit Request'}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>

            {/* Remaining cards: Getting started, Troubleshooting, Common questions */}
            <Card className="border-2 border-gray-200">
              <CardHeader>
                <CardTitle className="text-base font-bold text-gray-900 flex items-center gap-2">
                  <BookOpen className="h-4 w-4" />
                  Getting started
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-gray-800">
                <div>
                  <p className="font-semibold">1. Viewing a tender</p>
                  <p className="text-gray-600 mt-1">
                    Go to the <span className="font-semibold">Tenders</span> page, pick a row, and open it to see full details, attached bid document, and additional documents.
                  </p>
                </div>
                <div>
                  <p className="font-semibold">2. Shortlisting</p>
                  <p className="text-gray-600 mt-1">
                    Use the <span className="font-semibold">Shortlist</span> button to mark important bids.
                  </p>
                </div>
                <div>
                  <p className="font-semibold">3. Additional documents</p>
                  <p className="text-gray-600 mt-1">
                    Click <span className="font-semibold">Preview Additional Docs</span> to fetch BOQs and annexures linked to the tender.
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card className="border-2 border-gray-200">
              <CardHeader>
                <CardTitle className="text-base font-bold text-gray-900 flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-yellow-500" />
                  Troubleshooting
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 text-sm text-gray-800">
                <div>
                  <p className="font-semibold">Bid Document Preview is blank</p>
                  <p className="text-gray-600 mt-1">
                    This typically means the PDF has not finished syncing yet.
                  </p>
                </div>

                <div>
                  <p className="font-semibold">No Additional Docs found</p>
                  <p className="text-gray-600 mt-1">
                    Some tenders do not expose annexures/BOQs as separate links.
                  </p>
                </div>

                <div>
                  <p className="font-semibold">Extracted fields look wrong</p>
                  <p className="text-gray-600 mt-1">
                    AI parsing can miss items inside complex BOQs. Always verify in the PDF.
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card className="border-2 border-gray-200">
              <CardHeader>
                <CardTitle className="text-base font-bold text-gray-900 flex items-center gap-2">
                  <LifeBuoy className="h-4 w-4" />
                  Common questions
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 text-sm text-gray-800">
                <div>
                  <p className="font-semibold">Is this linked to my GeM account?</p>
                  <p className="text-gray-600 mt-1">
                    No — this tool reads public tender documents; it does not log in or bid.
                  </p>
                </div>

                <div>
                  <p className="font-semibold">Can I rely only on the AI summary?</p>
                  <p className="text-gray-600 mt-1">
                    AI summaries save time, but you must review the official GeM PDF.
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Right column */}
          <div className="space-y-4">
            {/* Tips card */}
            <Card className="border-2 border-gray-200">
              <CardHeader>
                <CardTitle className="text-base font-bold text-gray-900">Tips for better use</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-gray-800">
                <ul className="list-disc list-inside space-y-1 text-gray-600">
                  <li>Always open the GeM link before taking action.</li>
                  <li>Verify quantities and delivery locations in the PDF.</li>
                  <li>Use Shortlist to avoid noise.</li>
                </ul>
                <Button
                  variant="ghost"
                  className="px-0 text-sm font-semibold text-blue-600 hover:text-blue-700 hover:bg-transparent"
                >
                  Read detailed guide
                  <ArrowRight className="h-4 w-4 ml-1" />
                </Button>
              </CardContent>
            </Card>

            {/* Quick Links */}
            <Card className="border-2 border-gray-200">
              <CardHeader>
                <CardTitle className="text-base font-bold text-gray-900">Quick links</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-gray-800">
                <div className="space-y-2">
                  <a
                    className="block text-blue-600 font-medium hover:underline"
                    href="mailto:support@example.com"
                  >
                    <Mail className="inline h-4 w-4 mr-2 align-text-bottom" />
                    Email support
                  </a>

                  <a
                    className="block text-blue-600 font-medium hover:underline"
                    href="https://wa.me/000000000000"
                    target="_blank"
                    rel="noreferrer"
                  >
                    <MessageCircle className="inline h-4 w-4 mr-2 align-text-bottom" />
                    Chat on WhatsApp
                  </a>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
