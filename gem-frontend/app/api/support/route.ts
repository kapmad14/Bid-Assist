// app/api/support/route.ts
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import nodemailer from 'nodemailer';
import type { Transporter } from "nodemailer";

// Allow fallback to NEXT_PUBLIC_* so dev works even if server-only vars are missing
const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;

const SUPABASE_SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||   // 👈 your actual var
  process.env.SUPABASE_KEY_SERVICE ||
  process.env.SUPABASE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const SUPPORT_EMAIL_TO =
  process.env.SUPPORT_EMAIL_TO || process.env.NEXT_PUBLIC_SUPPORT_EMAIL || '';


const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST!,
  port: 587,
  auth: {
    user: process.env.SMTP_USER!,
    pass: process.env.SMTP_PASS!,
  },
});

// SMTP settings (optional)
const SMTP_HOST = process.env.SMTP_HOST || '';
const SMTP_PORT = process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : 0;
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error(
    'Missing SUPABASE_URL or SUPABASE_SERVICE_KEY / NEXT_PUBLIC_SUPABASE_ANON_KEY in env for API /api/support'
  );
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
    secure: SMTP_PORT === 465,
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

    const name = String(body.name || '').trim();
    const email = String(body.email || '').trim();
    const subject = String(body.subject || '').trim();
    const message = String(body.message || '').trim();
    const user_id = body.user_id ? String(body.user_id).trim() : null;

    const debugAttachmentPath = '/mnt/data/Sidebar.tsx';

    if (!name || !email || !subject || !message) {
      return NextResponse.json(
        { success: false, error: 'missing_fields' },
        { status: 400 }
      );
    }

    if (!user_id) {
      return NextResponse.json(
        { success: false, error: 'missing_user_id' },
        { status: 400 }
      );
    }

    const insertPayload = {
      user_id,
      name,
      email,
      subject,
      message,
      attachment_url: debugAttachmentPath,
      sent_via_email: false,
    };

    const { data: insertData, error: insertErr } = await supabase
      .from('support_requests')
      .insert(insertPayload)
      .select()
      .single();

    if (insertErr) {
      console.error('Supabase insert error for support request:', insertErr);
      return NextResponse.json(
        {
          success: false,
          error: 'db_insert_failed',
          details:
            (insertErr as any)?.message ||
            JSON.stringify(insertErr, null, 2),
        },
        { status: 500 }
      );
    }

    const to = SUPPORT_EMAIL_TO || SMTP_USER || 'support@example.com';
    const mailSubject = `[Support Request] ${subject}`;
    const html = `
      <p><strong>Name:</strong> ${name}</p>
      <p><strong>Email:</strong> ${email}</p>
      <p><strong>Message:</strong></p>
      <pre style="white-space:pre-wrap">${message}</pre>
      <p><strong>Attachment (local debug path):</strong> ${debugAttachmentPath}</p>
      <p><em>Stored in Supabase support_requests table (id: ${
        insertData?.id ?? 'n/a'
      })</em></p>
    `;
    const text = `Name: ${name}\nEmail: ${email}\n\nMessage:\n${message}\n\nAttachment: ${debugAttachmentPath}`;

    let emailResult = { ok: false, reason: 'not-attempted' };

    try {
      const sendResult = await sendSupportEmail({
        to,
        subject: mailSubject,
        html,
        text,
      });
      if (sendResult.ok) {
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

    return NextResponse.json({
      success: true,
      inserted: insertData ?? null,
      email: emailResult,
    });
  } catch (err: any) {
    console.error('Unexpected API error /api/support:', err);
    return NextResponse.json(
      { success: false, error: err?.message || String(err) },
      { status: 500 }
    );
  }
}
