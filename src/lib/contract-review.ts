import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireDashboardAuth } from "@/lib/auth";
import {
  formatBillyGptContextForModel,
  getBillyGptContextBundle,
} from "@/lib/notion-knowledge";
import { callOpenAiText, getOpenAiDiagnostics, getOpenAiEnvDiagnostics } from "@/lib/openai.server";

type ContractExtractionStatus = "none" | "success" | "low_text" | "failed";
type ContractUploadStatus = "none" | "received" | "rejected" | "reviewed";

export type ContractReviewDiagnostics = {
  checkedAt: string;
  openAiKeyPresent: boolean;
  modelUsed: string;
  uploadStatus: ContractUploadStatus;
  extractionStatus: ContractExtractionStatus;
  lastReviewAt: string | null;
  lastFileName: string | null;
  lastFileSizeBytes: number | null;
  lastExtractedChars: number;
  lastSentChars: number;
  truncatedForCostSafety: boolean;
  temporaryFileHandling: "memory-only";
  maxPdfBytes: number;
  maxContractCharsSent: number;
  lastError: string | null;
};

type ContractReviewGlobal = typeof globalThis & {
  __teamBillionContractReviewDiagnostics?: ContractReviewDiagnostics;
};

const MAX_PDF_BYTES = 10 * 1024 * 1024;
const MAX_CONTRACT_CHARS_SENT = 65_000;
const MIN_USEFUL_TEXT_CHARS = 400;
const MAX_BASE64_CHARS = Math.ceil((MAX_PDF_BYTES * 4) / 3) + 128;

const contractPdfInput = z.object({
  fileName: z.string().trim().min(1).max(180),
  mimeType: z.string().trim().max(120).optional().default("application/pdf"),
  fileBase64: z.string().min(1).max(MAX_BASE64_CHARS),
});

function defaultDiagnostics(): ContractReviewDiagnostics {
  const openAi = getOpenAiDiagnostics();

  return {
    checkedAt: new Date().toISOString(),
    openAiKeyPresent: openAi.keyPresent,
    modelUsed: openAi.modelUsed,
    uploadStatus: "none",
    extractionStatus: "none",
    lastReviewAt: null,
    lastFileName: null,
    lastFileSizeBytes: null,
    lastExtractedChars: 0,
    lastSentChars: 0,
    truncatedForCostSafety: false,
    temporaryFileHandling: "memory-only",
    maxPdfBytes: MAX_PDF_BYTES,
    maxContractCharsSent: MAX_CONTRACT_CHARS_SENT,
    lastError: null,
  };
}

function getGlobalStore() {
  return globalThis as ContractReviewGlobal;
}

function updateContractDiagnostics(next: Partial<ContractReviewDiagnostics>) {
  const store = getGlobalStore();
  store.__teamBillionContractReviewDiagnostics = {
    ...(store.__teamBillionContractReviewDiagnostics ?? defaultDiagnostics()),
    ...next,
    checkedAt: new Date().toISOString(),
    openAiKeyPresent: getOpenAiDiagnostics().keyPresent,
    modelUsed: getOpenAiDiagnostics().modelUsed,
  };
}

export function getContractReviewDiagnostics(): ContractReviewDiagnostics {
  const current = getGlobalStore().__teamBillionContractReviewDiagnostics ?? defaultDiagnostics();
  const openAi = getOpenAiDiagnostics();

  return {
    ...current,
    checkedAt: new Date().toISOString(),
    openAiKeyPresent: openAi.keyPresent,
    modelUsed: openAi.modelUsed,
  };
}

export function getContractReviewEnvDiagnostics() {
  return getOpenAiEnvDiagnostics();
}

function cleanFileName(value: string) {
  return value.replace(/[^\w .()[\]-]/g, "").trim() || "contract.pdf";
}

function decodeBase64ToBytes(base64: string) {
  const clean = base64.includes(",") ? base64.split(",").pop() ?? "" : base64;
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function bytesToBinary(bytes: Uint8Array) {
  let output = "";
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    output += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }

  return output;
}

function binaryToBytes(binary: string) {
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index) & 0xff;
  }

  return bytes;
}

function normalizeExtractedText(value: string) {
  return value
    .replace(/\u0000/g, "")
    .replace(/[\u0001-\u0008\u000b\u000c\u000e-\u001f]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .trim();
}

function decodePdfLiteralString(value: string) {
  const inner = value.slice(1, -1);
  let output = "";

  for (let index = 0; index < inner.length; index += 1) {
    const char = inner[index];

    if (char !== "\\") {
      output += char;
      continue;
    }

    const next = inner[index + 1];
    index += 1;

    if (next === "n") output += "\n";
    else if (next === "r") output += "\r";
    else if (next === "t") output += "\t";
    else if (next === "b") output += "\b";
    else if (next === "f") output += "\f";
    else if (next === "(" || next === ")" || next === "\\") output += next;
    else if (/[0-7]/.test(next ?? "")) {
      let octal = next ?? "";
      for (let step = 0; step < 2 && /[0-7]/.test(inner[index + 1] ?? ""); step += 1) {
        octal += inner[index + 1];
        index += 1;
      }
      output += String.fromCharCode(Number.parseInt(octal, 8));
    } else if (next) {
      output += next;
    }
  }

  return output;
}

function decodeHexString(value: string) {
  const hex = value.replace(/[<>\s]/g, "");
  if (hex.length < 4 || hex.length % 2 !== 0) return "";
  const bytes = new Uint8Array(hex.length / 2);

  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }

  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    let output = "";
    for (let index = 2; index + 1 < bytes.length; index += 2) {
      output += String.fromCharCode((bytes[index] << 8) | bytes[index + 1]);
    }
    return output;
  }

  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

function extractTextOperators(streamText: string) {
  const literalMatches = streamText.match(/\((?:\\.|[^\\()])*\)/g) ?? [];
  const hexMatches = streamText.match(/<[\da-fA-F\s]{4,}>/g) ?? [];
  const literalText = literalMatches.map(decodePdfLiteralString);
  const hexText = hexMatches
    .filter((match) => !match.startsWith("<<"))
    .map(decodeHexString);

  return normalizeExtractedText([...literalText, ...hexText].join(" "));
}

async function inflatePdfStream(bytes: Uint8Array) {
  const decompress = async (format: "deflate" | "deflate-raw") => {
    const stream = new DecompressionStream(format);
    const writer = stream.writable.getWriter();
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    await writer.write(copy);
    await writer.close();
    return new Uint8Array(await new Response(stream.readable).arrayBuffer());
  };

  try {
    return await decompress("deflate");
  } catch {
    try {
      return await decompress("deflate-raw");
    } catch {
      return bytes;
    }
  }
}

async function extractPdfText(bytes: Uint8Array) {
  const binary = bytesToBinary(bytes);
  const chunks: string[] = [];
  let searchFrom = 0;

  while (searchFrom < binary.length) {
    const streamIndex = binary.indexOf("stream", searchFrom);
    if (streamIndex === -1) break;

    let dataStart = streamIndex + "stream".length;
    if (binary[dataStart] === "\r" && binary[dataStart + 1] === "\n") dataStart += 2;
    else if (binary[dataStart] === "\n" || binary[dataStart] === "\r") dataStart += 1;

    const endIndex = binary.indexOf("endstream", dataStart);
    if (endIndex === -1) break;

    const dictionaryStart = Math.max(0, binary.lastIndexOf("<<", streamIndex));
    const dictionary = binary.slice(dictionaryStart, streamIndex);
    const streamBytes = binaryToBytes(binary.slice(dataStart, endIndex));
    const decodedBytes = /\/FlateDecode|\/Fl\b/.test(dictionary)
      ? await inflatePdfStream(streamBytes)
      : streamBytes;
    const decodedText = new TextDecoder("latin1", { fatal: false }).decode(decodedBytes);
    const extracted = extractTextOperators(decodedText);

    if (extracted) chunks.push(extracted);
    searchFrom = endIndex + "endstream".length;
  }

  const rawFallback = chunks.length === 0 ? extractTextOperators(binary) : "";
  const text = normalizeExtractedText([...chunks, rawFallback].join("\n\n"));

  return {
    text,
    extractedChars: text.length,
    status:
      text.length >= MIN_USEFUL_TEXT_CHARS
        ? ("success" as const)
        : text.length > 0
          ? ("low_text" as const)
          : ("failed" as const),
  };
}

function truncateContractText(text: string) {
  const truncated = text.length > MAX_CONTRACT_CHARS_SENT;

  return {
    text: truncated
      ? `${text.slice(0, MAX_CONTRACT_CHARS_SENT)}\n\n[Contract text truncated for cost-safe processing.]`
      : text,
    truncated,
  };
}

function friendlyContractError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/OPENAI_API_KEY/i.test(message)) {
    return "Contract review is not connected to the AI model yet.";
  }
  if (/extract|text|PDF/i.test(message)) {
    return "I could not read enough text from this PDF. Try a text-based PDF instead of a scanned image.";
  }
  return "I could not review this PDF right now. Try again in a moment.";
}

export const reviewContractPdf = createServerFn({ method: "POST" })
  .inputValidator(contractPdfInput)
  .handler(async ({ data }) => {
    await requireDashboardAuth();

    const fileName = cleanFileName(data.fileName);
    updateContractDiagnostics({
      uploadStatus: "received",
      extractionStatus: "none",
      lastFileName: fileName,
      lastError: null,
    });

    try {
      if (!/pdf/i.test(data.mimeType) && !fileName.toLowerCase().endsWith(".pdf")) {
        throw new Error("Only PDF contract uploads are supported.");
      }

      const bytes = decodeBase64ToBytes(data.fileBase64);

      if (bytes.byteLength > MAX_PDF_BYTES) {
        updateContractDiagnostics({
          uploadStatus: "rejected",
          lastFileSizeBytes: bytes.byteLength,
          lastError: "PDF exceeded the size limit.",
        });
        throw new Error("PDF exceeded the size limit.");
      }

      const extraction = await extractPdfText(bytes);

      if (extraction.status === "failed") {
        updateContractDiagnostics({
          extractionStatus: "failed",
          lastFileSizeBytes: bytes.byteLength,
          lastExtractedChars: 0,
          lastSentChars: 0,
          lastError: "No readable PDF text was extracted.",
        });
        throw new Error("No readable PDF text was extracted.");
      }

      const costSafeContract = truncateContractText(extraction.text);
      const context = await getBillyGptContextBundle(
        "influencer marketing contract review red flags usage rights exclusivity payment deliverables cancellation brand negotiation Team Billion preferences",
        { includeWeb: true },
      );
      const modelInput = `Contract file: ${fileName}
Extraction status: ${extraction.status}
Contract text characters extracted: ${extraction.extractedChars}
Contract text characters sent: ${costSafeContract.text.length}

Team Billion source context:
${formatBillyGptContextForModel(context)}

Extracted contract text:
${costSafeContract.text}`;
      const response = await callOpenAiText({
        instructions:
          'You are Billy GPT reviewing an influencer/brand contract for Team Billion. This is not legal advice. Use [handbook] context first for Team Billion preferences and rules, [sheets] for operational context, and [web] only for general legal/business context. Do not claim to be a lawyer. Do not dump raw contract text. Return exactly these sections: "1. Plain-English summary", "2. Risky clauses", "3. Suggested edits/redlines", "4. Questions to ask the brand", "5. Final negotiation notes". Be specific, practical, and concise. For suggested edits, use bullets with "Original concern" and "Suggested wording" when possible.',
        input: modelInput,
        maxOutputTokens: 2200,
      });
      const review = `This is not legal advice.\n\n${response.text}`;

      updateContractDiagnostics({
        uploadStatus: "reviewed",
        extractionStatus: extraction.status,
        lastReviewAt: new Date().toISOString(),
        lastFileName: fileName,
        lastFileSizeBytes: bytes.byteLength,
        lastExtractedChars: extraction.extractedChars,
        lastSentChars: costSafeContract.text.length,
        truncatedForCostSafety: costSafeContract.truncated,
        lastError: null,
      });

      return {
        ok: true as const,
        review,
        fileName,
        extractionStatus: extraction.status,
        extractedChars: extraction.extractedChars,
        sentChars: costSafeContract.text.length,
      };
    } catch (error) {
      const safeMessage = friendlyContractError(error);
      updateContractDiagnostics({
        uploadStatus: "rejected",
        lastError: safeMessage,
      });

      return {
        ok: false as const,
        message: safeMessage,
      };
    }
  });
