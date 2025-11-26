import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const { tenderId } = await request.json();
    
    if (!tenderId) {
      return NextResponse.json(
        { error: 'Tender ID is required' },
        { status: 400 }
      );
    }
    
    // Call simplified Python script (just extracts URLs, no file downloads)
    const pythonProcess = spawn('python3', [
      '/Users/kapilmadan/Projects/Bid-Assist/extract_document_urls.py',
      tenderId.toString()
    ]);
    
    let result = '';
    let error = '';
    
    pythonProcess.stdout.on('data', (data) => {
      result += data.toString();
    });
    
    pythonProcess.stderr.on('data', (data) => {
      error += data.toString();
    });
    
    // 👇 Explicitly type the Promise as Promise<Response>
    return new Promise<Response>((resolve) => {
      pythonProcess.on('close', (code) => {
        if (code === 0) {
          try {
            resolve(NextResponse.json(JSON.parse(result)));
          } catch (parseError) {
            resolve(NextResponse.json(
              { error: 'Failed to parse response' },
              { status: 500 }
            ));
          }
        } else {
          resolve(NextResponse.json(
            { error: error || 'Extraction failed' },
            { status: 500 }
          ));
        }
      });
    });

  } catch (error: any) {
    return NextResponse.json(
      { error: error.message ?? 'Unknown error' },
      { status: 500 }
    );
  }
}
