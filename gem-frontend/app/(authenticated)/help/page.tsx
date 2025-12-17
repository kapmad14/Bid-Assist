'use client';

import { useState, useMemo } from 'react';
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
import { createClient } from '@/lib/supabase-client';

// ⛔ Prevents static rendering errors
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export default function HelpSupportPage() {
  // ✅ Supabase client created ONLY in browser
  const supabase = useMemo(() => {
    if (typeof window !== 'undefined') {
      return createClient();
    }
    return null;
  }, []);

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

    if (!supabase) {
      setErrorMsg('Supabase is not ready. Please refresh.');
      return;
    }

    setLoading(true);
    try {
      // 🔑 Get logged-in user
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError) {
        console.error('Error fetching user:', userError);
      }

      const user_id = userData?.user?.id ?? null;

      if (!user_id) {
        setErrorMsg('You must be logged in to submit a support request.');
        setLoading(false);
        return;
      }

      const res = await fetch('/api/support', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, subject, message, user_id }),
      });

      const contentType = res.headers.get('content-type') || '';
      let data: any = null;

      if (contentType.includes('application/json')) {
        data = await res.json();
      } else {
        const text = await res.text();
        console.error('Non-JSON response:', text);
        throw new Error('Invalid server response');
      }

      if (!res.ok || !data?.success) {
        setErrorMsg(data?.error || 'Failed to submit request');
      } else {
        setResultMsg('Support request submitted. We will get back to you shortly.');
        setName('');
        setEmail('');
        setSubject('');
        setMessage('');
      }
    } catch (err: any) {
      console.error(err);
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
          <h1 className="text-xl font-bold text-gray-900">Help & Support</h1>
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
                        type="text"
                        placeholder="Your name"
                        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-[#F7C846]"
                      />
                    </div>

                    <div className="flex flex-col">
                      <label className="font-semibold text-gray-900 mb-1">Email</label>
                      <input
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        type="email"
                        placeholder="you@example.com"
                        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-[#F7C846]"
                      />
                    </div>
                  </div>

                  <div className="flex flex-col">
                    <label className="font-semibold text-gray-900 mb-1">Subject</label>
                    <input
                      value={subject}
                      onChange={(e) => setSubject(e.target.value)}
                      type="text"
                      placeholder="Brief description of your issue"
                      className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-[#F7C846]"
                    />
                  </div>

                  <div className="flex flex-col">
                    <label className="font-semibold text-gray-900 mb-1">Message</label>
                    <textarea
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      rows={6}
                      placeholder="Describe your issue in detail"
                      className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 shadow-sm resize-none focus:outline-none focus:ring-2 focus:ring-[#F7C846]"
                    />
                  </div>

                  {errorMsg && <div className="text-sm text-red-600 font-medium">{errorMsg}</div>}
                  {resultMsg && (
                    <div className="text-sm text-green-600 font-medium">{resultMsg}</div>
                  )}

                  <div className="flex justify-end">
                    <Button
                      type="submit"
                      className="bg-[#F7C846] hover:bg-[#e5b53d] text-[#0E121A] font-bold rounded-full py-3 px-6 shadow-md shadow-gray-300/40"
                      disabled={loading}
                    >
                      {loading ? 'Submitting...' : 'Submit Request'}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>

            {/* Remaining cards… unchanged */}
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
                    Go to the <span className="font-semibold">Tenders</span> page and open a row to
                    view details.
                  </p>
                </div>

                <div>
                  <p className="font-semibold">2. Shortlisting</p>
                  <p className="text-gray-600 mt-1">Use Shortlist to mark important bids.</p>
                </div>

                <div>
                  <p className="font-semibold">3. Additional documents</p>
                  <p className="text-gray-600 mt-1">
                    Click “Preview Additional Docs” to fetch annexures.
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
                  <p className="text-gray-600 mt-1">The PDF may still be syncing.</p>
                </div>

                <div>
                  <p className="font-semibold">No Additional Docs found</p>
                  <p className="text-gray-600 mt-1">Some tenders do not expose annexures.</p>
                </div>

                <div>
                  <p className="font-semibold">Extracted fields look wrong</p>
                  <p className="text-gray-600 mt-1">Always verify in the original PDF.</p>
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
                  <p className="text-gray-600 mt-1">No — this reads public documents.</p>
                </div>

                <div>
                  <p className="font-semibold">Can I rely only on the AI summary?</p>
                  <p className="text-gray-600 mt-1">Always verify the official PDF.</p>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Right column */}
          <div className="space-y-4">
            <Card className="border-2 border-gray-200">
              <CardHeader>
                <CardTitle className="text-base font-bold text-gray-900">
                  Tips for better use
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-gray-800">
                <ul className="list-disc list-inside space-y-1 text-gray-600">
                  <li>Always open the GeM link before taking action.</li>
                  <li>Verify quantities and locations in the PDF.</li>
                  <li>Use Shortlist to reduce noise.</li>
                </ul>
              </CardContent>
            </Card>

            <Card className="border-2 border-gray-200">
              <CardHeader>
                <CardTitle className="text-base font-bold text-gray-900">Quick links</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-gray-800">
                <a className="block text-blue-600 font-medium hover:underline" href="mailto:support@example.com">
                  <Mail className="inline h-4 w-4 mr-2" />
                  Email support
                </a>

                <a
                  className="block text-blue-600 font-medium hover:underline"
                  href="https://wa.me/000000000000"
                  target="_blank"
                  rel="noreferrer"
                >
                  <MessageCircle className="inline h-4 w-4 mr-2" />
                  Chat on WhatsApp
                </a>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
