import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
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
  reviewChunkCount: number;
  openAiCallCount: number;
  sourcesUsed: string[];
  lastError: string | null;
};

type ContractReviewGlobal = typeof globalThis & {
  __teamBillionContractReviewDiagnostics?: ContractReviewDiagnostics;
};

const MAX_PDF_BYTES = 10 * 1024 * 1024;
const MAX_CONTRACT_CHARS_SENT = 65_000;
const CONTRACT_CHUNK_CHARS = 12_000;
const MAX_CONTRACT_CHUNKS = 6;
const MIN_USEFUL_TEXT_CHARS = 400;
const MAX_BASE64_CHARS = Math.ceil((MAX_PDF_BYTES * 4) / 3) + 128;

const contractPdfInput = z.object({
  fileName: z.string().trim().min(1),
  mimeType: z.string().trim().optional().default("application/pdf"),
  fileBase64: z.string().min(1),
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
    reviewChunkCount: 0,
    openAiCallCount: 0,
    sourcesUsed: [],
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
    text: truncated ? text.slice(0, MAX_CONTRACT_CHARS_SENT) : text,
    truncated,
  };
}

function splitContractText(text: string) {
  const costSafe = truncateContractText(text);
  const sentences = costSafe.text.match(/[^.!?]+[.!?]+|\S[\s\S]{0,220}(?=\s|$)/g) ?? [
    costSafe.text,
  ];
  const chunks: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    const next = sentence.trim();
    if (!next) continue;

    if (current && `${current} ${next}`.length > CONTRACT_CHUNK_CHARS) {
      chunks.push(current.trim());
      current = next;
      continue;
    }

    current = current ? `${current} ${next}` : next;
  }

  if (current.trim()) chunks.push(current.trim());

  return {
    chunks: chunks.slice(0, MAX_CONTRACT_CHUNKS),
    truncated: costSafe.truncated || chunks.length > MAX_CONTRACT_CHUNKS,
    sentChars: chunks.slice(0, MAX_CONTRACT_CHUNKS).join("\n").length,
  };
}

function getSourceLabels(tags: Array<"handbook" | "sheets" | "web">) {
  const labels = ["Contract"];

  if (tags.includes("handbook")) labels.push("Handbook");
  if (tags.includes("sheets")) labels.push("Sheets");
  if (tags.includes("web")) labels.push("Web");

  return labels;
}

function appendContractSources(review: string, sources: string[]) {
  const clean = review.trim();
  const withoutDuplicateDisclaimer = clean.replace(/\n*This is not legal advice\.?\s*$/i, "");
  const sourceLine = `Sources used: ${sources.join(", ")}`;
  const withSources = /Sources used:/i.test(withoutDuplicateDisclaimer)
    ? withoutDuplicateDisclaimer
    : `${withoutDuplicateDisclaimer}\n\n${sourceLine}`;

  return `${withSources}\n\nThis is not legal advice.`;
}

function cleanModelContractReview(value: string) {
  const lines = value
    .replace(/```(?:json|markdown)?/gi, "")
    .replace(/```/g, "")
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      return !/^(\{|\}|"schema"|raw|debug|extracted contract text|team billion source context|source context|contract text characters)/i.test(
        trimmed,
      );
    });

  return lines.join("\n").trim();
}

function contractContextQuery(fileName: string, text: string) {
  return [
    "Team Billion influencer marketing contract review preferences",
    "usage rights exclusivity deliverables payment cancellation approval revisions termination",
    fileName.replace(/\.pdf$/i, ""),
    text.slice(0, 1800),
  ].join(" ");
}

async function summarizeContractChunks(chunks: string[]) {
  const notes: string[] = [];

  for (const [index, chunk] of chunks.entries()) {
    const response = await callOpenAiText({
      instructions:
        "Create internal contract-review notes from this contract section. Do not write the final user answer. Do not quote long passages. Do not dump raw contract text. Keep it concise and practical. Capture parties, scope, payment, usage rights, exclusivity, deliverables, approval/revisions, termination, risky clauses, and possible redlines.",
      input: `Contract section ${index + 1} of ${chunks.length}:\n${chunk}`,
      maxOutputTokens: 900,
    });

    notes.push(`Section ${index + 1} notes:\n${response.text}`);
  }

  return notes;
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
    const { requireDashboardAuth } = await import("@/lib/auth.server");
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

      if (data.fileBase64.length > MAX_BASE64_CHARS) {
        updateContractDiagnostics({
          uploadStatus: "rejected",
          lastError: "PDF exceeded the size limit.",
        });
        throw new Error("PDF exceeded the size limit.");
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

      const contractChunks = splitContractText(extraction.text);
      const context = await getBillyGptContextBundle(
        contractContextQuery(fileName, extraction.text),
        { includeWeb: true },
      );
      const contractNotes = await summarizeContractChunks(contractChunks.chunks);
      const sourcesUsed = getSourceLabels(context.sourceTags);
      const modelInput = `Contract file: ${fileName}
Extraction status: ${extraction.status}
Contract sections reviewed: ${contractChunks.chunks.length}

Relevant Team Billion context, for internal use only:
${formatBillyGptContextForModel(context)}

Internal contract notes, for final answer:
${contractNotes.join("\n\n")}`;
      const response = await callOpenAiText({
        instructions:
          'You are Billy GPT reviewing an influencer/brand contract for Team Billion. Write a polished user-facing contract review. Use [handbook] context first, [sheets] if relevant, and [web] only as general external context. Never expose raw extraction text, raw handbook chunks, JSON, schema text, logs, debug messages, or stack traces. Return exactly these sections: "Contract summary", "Risk level", "Key issues", "Suggested redlines/edits", "Questions to ask the brand/client", "Negotiation notes". Be specific, concise, and practical. For redlines, write suggested replacement wording when possible.',
        input: modelInput,
        maxOutputTokens: 2600,
      });
      const review = appendContractSources(cleanModelContractReview(response.text), sourcesUsed);

      updateContractDiagnostics({
        uploadStatus: "reviewed",
        extractionStatus: extraction.status,
        lastReviewAt: new Date().toISOString(),
        lastFileName: fileName,
        lastFileSizeBytes: bytes.byteLength,
        lastExtractedChars: extraction.extractedChars,
        lastSentChars: contractChunks.sentChars,
        truncatedForCostSafety: contractChunks.truncated,
        reviewChunkCount: contractChunks.chunks.length,
        openAiCallCount: contractChunks.chunks.length + 1,
        sourcesUsed,
        lastError: null,
      });

      return {
        ok: true as const,
        review,
        fileName,
        extractionStatus: extraction.status,
        extractedChars: extraction.extractedChars,
        sentChars: contractChunks.sentChars,
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
