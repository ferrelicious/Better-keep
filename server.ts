/// <reference types="node" />
import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') return null;
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

interface ParsedMailResult {
  item_category: 'package' | 'invoice' | 'letter';
  carrier: string;
  sender: string;
  pickup_code: string;
  tracking_id: string;
  pickup_location: string;
  pickup_address: string;
  ocr_number: string;
  payment_recipient: string;
  amount: string;
  due_date: string;
}

function normalizeParsedMail(raw: Record<string, unknown>): ParsedMailResult {
  const catRaw = String(raw.item_category || '').trim().toLowerCase();
  const item_category: 'package' | 'invoice' | 'letter' =
    catRaw === 'package'
      ? 'package'
      : catRaw === 'invoice' || catRaw === 'bill'
        ? 'invoice'
        : catRaw === 'letter'
          ? 'letter'
          : 'letter';

  const clean = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
  const rawDate = clean(raw.due_date);
  const due_date = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : '';

  return {
    item_category,
    carrier: clean(raw.carrier),
    sender: clean(raw.sender),
    pickup_code: clean(raw.pickup_code),
    tracking_id: clean(raw.tracking_id),
    pickup_location: clean(raw.pickup_location),
    pickup_address: clean(raw.pickup_address),
    ocr_number: clean(raw.ocr_number),
    payment_recipient: clean(raw.payment_recipient),
    amount: clean(raw.amount),
    due_date,
  };
}

async function startServer() {
  const app = express();
  const httpServer = http.createServer(app);

  app.use(express.json({ limit: '15mb' }));

  // Allow Capacitor native Android WebView (https://localhost / capacitor://localhost)
  app.use('/api', (req: Request, res: Response, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ ok: true });
  });

  app.post('/api/mail/parse', async (req: Request, res: Response) => {
    try {
      const ai = getGeminiClient();
      if (!ai) {
        res.status(503).json({
          error:
            'GEMINI_API_KEY saknas på servern. Kontrollera miljövariabeln i Settings > Secrets.',
        });
        return;
      }

      const body = (req.body ?? {}) as {
        text?: unknown;
        imageBase64?: unknown;
        mimeType?: unknown;
      };

      const rawText = typeof body.text === 'string' ? body.text.trim() : '';
      const rawBase64 =
        typeof body.imageBase64 === 'string' ? body.imageBase64.trim() : '';
      const mimeType =
        typeof body.mimeType === 'string' && body.mimeType.startsWith('image/')
          ? body.mimeType
          : 'image/jpeg';

      if (!rawText && !rawBase64) {
        res.status(400).json({
          error: 'Skicka en bild eller text att tolka.',
        });
        return;
      }

      const parts: Array<
        { inlineData: { mimeType: string; data: string } } | { text: string }
      > = [];

      if (rawBase64) {
        const cleanBase64 = rawBase64.includes(',')
          ? rawBase64.split(',').pop() || ''
          : rawBase64;
        parts.push({
          inlineData: {
            mimeType,
            data: cleanBase64,
          },
        });
      }

      const todayIso = new Date().toISOString().slice(0, 10);
      parts.push({
        text: [
          `Dagens datum är ${todayIso}.`,
          'Analysera denna svenska skärmdump (SMS-tråd, Kivra-avi, mejl, faktura eller pappersavi) och returnera en JSON med en lista "items" med alla unika identifierade försändelser eller räkningar.',
          rawText ? `\nInklistrad text:\n${rawText}` : '',
        ]
          .filter(Boolean)
          .join('\n'),
      });

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: { parts },
        config: {
          systemInstruction:
            'Du är en expert på svensk dokument-, SMS- och avitolkning för hushållsappen BetterKeep.\n\n' +
            'VIKTIGA INSTRUKTIONER:\n' +
            '1. IGNORERA ALLT MOBILT UI-BRUS: Ignorera batteriprocent, klockslag i statusfältet, tangentbord, statusikoner, "Tryck för att läsa in förhandsgranskning", "Skicka meddelande", "Meddelandeinfo" och liknande operativsystemsdetaljer.\n' +
            '2. RELEVANT STATUS VID SMS-TRÅDAR: Ignorera gamla misslyckade leveransförsök eller äldre statusar om det finns ett nyare SMS i tråden som visar att paketet har anlänt till ombud, paketskåp eller är redo för uthämtning.\n' +
            '3. FLERA FÖRSÄNDELSER / RÄKNINGAR: Om skärmdumpen eller texten innehåller TVÅ ELLER FLER olika paket/kollinummer eller fakturor (t.ex. två olika FedEx-, PostNord- eller Instabox-kollinummer i samma SMS-tråd), returnera ett separat objekt i arrayen "items" för VARJE unikt kollinummer, paket eller faktura!\n' +
            '4. KLASSIFICERING:\n' +
            '   - "package": paket/leverans/spårning/ombud/paketskåp från t.ex. FedEx, PostNord, Instabox, Budbee, DHL, Bring, Schenker, Early Bird, etc.\n' +
            '   - "invoice": räkning/faktura/betalningsavi från t.ex. Kivra, företag, elbolag, bankgiro/plusgiro.\n' +
            '   - "letter": övrigt viktigt myndighetsbrev eller meddelande utan betalning.\n' +
            '5. FÄLTEXTRAHERING:\n' +
            '   - pickup_code: Hämtningskod, pinkod, säkerhetskod eller skåpkod.\n' +
            '   - tracking_id: Kolli-ID, spårningsnummer, försändelse-ID.\n' +
            '   - pickup_location: Namn på ombud, butik eller paketskåp (t.ex. "ICA Kvantum Uppsala", "Instabox City Gross").\n' +
            '   - pickup_address: Gatuadress, postnummer och ort för ombudet om angivet.\n' +
            '   - carrier: Transportör eller tjänst (t.ex. FedEx, PostNord, Instabox, Budbee, DHL, Kivra).\n' +
            '   - sender: Avsändande butik eller företag (t.ex. Zalando, Amazon, Ellevio, Skatteverket).\n' +
            '   - ocr_number: OCR-nummer eller betalningsreferens.\n' +
            '   - payment_recipient: Bankgiro ("BG ...") eller Plusgiro ("PG ...").\n' +
            '   - amount: Belopp att betala (inkludera kr, t.ex. "499,00 kr").\n' +
            '   - due_date: Sista hämtningsdag för paket eller förfallodatum för räkning i formatet YYYY-MM-DD. Om endast dag och månad anges (t.ex. "hämta senast 28 nov"), använd dagens datum som referens för att beräkna korrekt YYYY-MM-DD.\n' +
            'Lämna fält som saknas som tom sträng "". Returnera minst ett objekt i "items" om något giltigt hittas, annars en tom lista.',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              items: {
                type: Type.ARRAY,
                description: 'Lista av identifierade paket, räkningar eller brev i underlaget',
                items: {
                  type: Type.OBJECT,
                  properties: {
                    item_category: {
                      type: Type.STRING,
                      description: "Exakt ett av: 'package', 'invoice', 'letter'",
                    },
                    carrier: {
                      type: Type.STRING,
                      description:
                        'Transportör eller tjänst (t.ex. FedEx, PostNord, Instabox, Budbee, DHL, Bring, Kivra)',
                    },
                    sender: {
                      type: Type.STRING,
                      description: 'Avsändare, butik eller företag',
                    },
                    pickup_code: {
                      type: Type.STRING,
                      description: 'Hämtningskod, pinkod eller skåpkod',
                    },
                    tracking_id: {
                      type: Type.STRING,
                      description: 'Kolli-ID eller spårningsnummer',
                    },
                    pickup_location: {
                      type: Type.STRING,
                      description: 'Namn på ombud, butik eller paketskåp',
                    },
                    pickup_address: {
                      type: Type.STRING,
                      description:
                        'Gatuadress, postnummer och ort för ombud eller paketskåp',
                    },
                    ocr_number: {
                      type: Type.STRING,
                      description: 'OCR-nummer eller betalningsreferens',
                    },
                    payment_recipient: {
                      type: Type.STRING,
                      description: 'Bankgiro eller Plusgiro',
                    },
                    amount: {
                      type: Type.STRING,
                      description: 'Belopp att betala',
                    },
                    due_date: {
                      type: Type.STRING,
                      description:
                        'Sista hämtningsdag eller förfallodatum i formatet YYYY-MM-DD',
                    },
                  },
                  required: ['item_category'],
                },
              },
            },
            required: ['items'],
          },
        },
      });

      const jsonText = (response.text ?? '{}').trim();
      let parsedObj: Record<string, unknown> = {};
      try {
        parsedObj = JSON.parse(jsonText) as Record<string, unknown>;
      } catch {
        parsedObj = {};
      }

      let rawItemsList: Array<Record<string, unknown>> = [];
      if (Array.isArray(parsedObj.items)) {
        rawItemsList = parsedObj.items as Array<Record<string, unknown>>;
      } else if (parsedObj.item_category) {
        rawItemsList = [parsedObj];
      }

      const normalizedItems = rawItemsList.map(normalizeParsedMail);
      const primaryResult = normalizedItems[0] || normalizeParsedMail({});

      res.json({
        items: normalizedItems,
        result: primaryResult,
      });
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Kunde inte tolka innehållet med AI.';
      res.status(500).json({ error: msg });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        ws: { server: httpServer },
        hmr: process.env.DISABLE_HMR === 'true' ? false : true,
      },
      appType: 'custom',
    });
    app.use(vite.middlewares);

    app.use('*', async (req: Request, res: Response, next) => {
      try {
        const fs = await import('fs/promises');
        const templatePath = path.resolve(__dirname, 'index.html');
        let template = await fs.readFile(templatePath, 'utf-8');
        template = await vite.transformIndexHtml(req.originalUrl, template);
        res.status(200).set({ 'Content-Type': 'text/html' }).end(template);
      } catch (e) {
        vite.ssrFixStacktrace(e as Error);
        next(e);
      }
    });
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`BetterKeep server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
