// app/api/support/route.ts
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import nodemailer from 'nodemailer';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_KEY_SERVICE || process.env.SUPABASE_KEY!;
const SUPPORT_EMAIL_TO = process.env.SUPPORT_EMAIL_TO || process.env.NEXT_PUBLIC_SUPPORT_EMAIL || '';
// SMTP settings (optional)
const SMTP_HOST = process.env.SMTP_HOST || '';
const SMTP_PORT = process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : 0;
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in env for API /api/support');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function sendSupportEmail({
  to,
  subject,
  html,
  text,
}: {
  to: string;
  subject: string;
  html: string;
  text: string;
}) {
  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS) {
    console.warn('SMTP settings missing; skipping email send.');
    return { ok: false, reason: 'smtp-not-configured' };
  }

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465, // true for 465, false for other ports
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS,
    },
  });

  const info = await transporter.sendMail({
    from: `"Support" <${SMTP_USER}>`,
    to,
    subject,
    text,
    html,
  });

  return { ok: true, info };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // Basic validation
    const name = String(body.name || '').trim();
    const email = String(body.email || '').trim();
    const subject = String(body.subject || '').trim();
    const message = String(body.message || '').trim();
    const gem_bid_id = body.gem_bid_id ? String(body.gem_bid_id).trim() : null;

    // Per developer instruction: include the uploaded file path as the attachment URL
    const debugAttachmentPath = '/mnt/data/Sidebar.tsx';

    if (!name || !email || !subject || !message) {
      return NextResponse.json({ success: false, error: 'missing_fields' }, { status: 400 });
    }

    // Insert into Supabase
    const insertPayload: any = {
      name,
      email,
      subject,
      message,
      attachment_url: debugAttachmentPath,
      gem_bid_id,
    };

    const { data: insertData, error: insertErr } = await supabase
      .from('support_requests')
      .insert(insertPayload)
      .select()
      .single();

    if (insertErr) {
      console.error('Supabase insert error for support request:', insertErr);
      // still attempt email send if configured — continue
    }

    // Compose email for human ops
    const to = SUPPORT_EMAIL_TO || SMTP_USER || 'support@example.com';
    const mailSubject = `[Support Request] ${subject} ${gem_bid_id ? `(${gem_bid_id})` : ''}`;
    const html = `
      <p><strong>Name:</strong> ${name}</p>
      <p><strong>Email:</strong> ${email}</p>
      ${gem_bid_id ? `<p><strong>GeM Bid:</strong> ${gem_bid_id}</p>` : ''}
      <p><strong>Message:</strong></p>
      <pre style="white-space:pre-wrap">${message}</pre>
      <p><strong>Attachment (local debug path):</strong> ${debugAttachmentPath}</p>
      <p><em>Stored in Supabase support_requests table (id: ${insertData?.id ?? 'n/a'})</em></p>
    `;
    const text = `Name: ${name}\nEmail: ${email}\n${gem_bid_id ? `GeM Bid: ${gem_bid_id}\n` : ''}\nMessage:\n${message}\n\nAttachment: ${debugAttachmentPath}`;

    let emailResult = { ok: false, reason: 'not-attempted' };

    try {
      const sendResult = await sendSupportEmail({ to, subject: mailSubject, html, text });
      if (sendResult.ok) {
        // mark DB row that email was sent
        if (insertData?.id) {
          await supabase
            .from('support_requests')
            .update({ sent_via_email: true })
            .eq('id', insertData.id);
        }
        emailResult = { ok: true };
      } else {
        emailResult = { ok: false, reason: sendResult.reason || 'send-failed' };
      }
    } catch (err) {
      console.error('Error sending support email:', err);
      emailResult = { ok: false, reason: 'send-exception' };
    }

    return NextResponse.json({ success: true, inserted: insertData ?? null, email: emailResult });
  } catch (err: any) {
    console.error('Unexpected API error /api/support:', err);
    return NextResponse.json({ success: false, error: err?.message || String(err) }, { status: 500 });
  }
}
