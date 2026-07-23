import { Filesystem, Directory } from "@capacitor/filesystem";
import { FileOpener } from "@capacitor-community/file-opener";
import { Capacitor } from "@capacitor/core";
import { getPdfDownloadUrl } from "./pdfService";
import { getBucketName, sanitizeStoragePath } from "./storageService";
import { supabase } from "./supabaseClient";
import { dataUrlToBlob } from "../utils/pdfUtils";

export interface OpenPdfOptions {
  url: string;
  title?: string;
  storagePath?: string;
  bucket?: string;
  noteId?: string;
  onProgress?: (percent: number, statusText: string) => void;
}

export interface OpenPdfResult {
  success: boolean;
  message?: string;
  cachedPath?: string;
  isNative?: boolean;
}

/**
 * Generates a deterministic, filesystem-safe filename for caching a PDF in Directory.Cache.
 */
export function getPdfCacheFileName(rawPathOrUrl: string, noteId?: string): string {
  const identifier = noteId || rawPathOrUrl || "document";
  const cleanSlug = identifier
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .replace(/_+/g, "_")
    .substring(0, 60);

  let hash = 0;
  for (let i = 0; i < identifier.length; i++) {
    hash = (hash << 5) - hash + identifier.charCodeAt(i);
    hash |= 0;
  }
  const safeHash = Math.abs(hash).toString(36);

  return `pdf_cache_${cleanSlug}_${safeHash}.pdf`;
}

/**
 * Converts a Blob into a Base64 string required by Filesystem.writeFile.
 */
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to read downloaded PDF file bytes."));
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.substring(dataUrl.indexOf(",") + 1);
      resolve(base64);
    };
    reader.readAsDataURL(blob);
  });
}

/**
 * Validates PDF header magic bytes (%PDF or Base64 equivalent JVBERi)
 */
async function validatePdfHeader(blob: Blob): Promise<boolean> {
  if (!blob || blob.size <= 0) return false;
  try {
    const headerSlice = blob.slice(0, 5);
    const headerText = await headerSlice.text();
    return headerText.startsWith("%PDF") || headerText.startsWith("JVBER");
  } catch {
    return false;
  }
}

/**
 * Downloads a PDF from Supabase storage, caches it in the app's native Cache Directory,
 * verifies its size, MIME type, and structure, and opens it using Android's native PDF viewer Intent.
 */
export async function openPdfWithNativeViewer(options: OpenPdfOptions): Promise<OpenPdfResult> {
  const { url, storagePath, bucket, noteId, onProgress } = options;

  const updateProgress = (percent: number, text: string) => {
    if (onProgress) onProgress(percent, text);
  };

  updateProgress(5, "Resolving PDF location...");

  if (!url && !storagePath) {
    throw new Error("Missing PDF file location or URL.");
  }

  const activeBucket = getBucketName(bucket);
  const activePath = sanitizeStoragePath(storagePath || url, activeBucket);
  const cacheFileName = getPdfCacheFileName(activePath || url, noteId);

  const isNative = Capacitor.isNativePlatform();

  // Step 1: Check existing cache in Directory.Cache
  if (isNative) {
    try {
      updateProgress(10, "Checking local cache...");
      const statResult = await Filesystem.stat({
        path: cacheFileName,
        directory: Directory.Cache
      });

      if (statResult && statResult.size > 0) {
        console.log(`[NativePdfService] Found existing cached file "${cacheFileName}" (${statResult.size} bytes).`);
        updateProgress(80, "Verifying cached PDF file...");

        const uriResult = await Filesystem.getUri({
          path: cacheFileName,
          directory: Directory.Cache
        });

        updateProgress(95, "Opening in Android PDF viewer...");

        try {
          await FileOpener.open({
            filePath: uriResult.uri,
            contentType: "application/pdf",
            openWithDefault: false
          });

          updateProgress(100, "PDF opened successfully");
          return { success: true, cachedPath: uriResult.uri, isNative: true };
        } catch (openerErr: any) {
          const errStr = String(openerErr?.message || openerErr).toLowerCase();
          console.warn("[NativePdfService] Cached file opener error:", openerErr);

          if (
            errStr.includes("no app") ||
            errStr.includes("activitynotfound") ||
            errStr.includes("not found") ||
            errStr.includes("no handler") ||
            errStr.includes("cannot open")
          ) {
            throw new Error("No PDF reader installed on this device.");
          }

          console.log("[NativePdfService] Removing invalid or unreadable cached file...");
          try {
            await Filesystem.deleteFile({ path: cacheFileName, directory: Directory.Cache });
          } catch {
            // ignore cleanup errors
          }
        }
      }
    } catch (cacheStatErr) {
      console.log("[NativePdfService] Cache miss or stat error, downloading:", cacheStatErr);
    }
  }

  // Step 2: Download PDF from Supabase Storage
  updateProgress(20, "Retrieving secure download URL...");
  let downloadUrl = "";
  try {
    downloadUrl = await getPdfDownloadUrl(url, activeBucket);
  } catch (resErr: any) {
    console.warn("[NativePdfService] getPdfDownloadUrl failed, trying fallback:", resErr);
  }

  let pdfBlob: Blob | null = null;

  // 2a. Direct Supabase Storage SDK download
  if (activePath && !url.startsWith("data:") && !url.startsWith("blob:")) {
    try {
      updateProgress(35, "Downloading PDF from Supabase Storage...");
      const { data: sdkData, error: sdkErr } = await supabase.storage.from(activeBucket).download(activePath);

      if (!sdkErr && sdkData && sdkData.size > 0) {
        pdfBlob = sdkData;
      } else {
        const { data: signedData, error: signedErr } = await supabase.storage
          .from(activeBucket)
          .createSignedUrl(activePath, 3600);

        if (!signedErr && signedData?.signedUrl) {
          downloadUrl = signedData.signedUrl;
        }
      }
    } catch (sdkEx) {
      console.warn("[NativePdfService] Direct SDK download exception:", sdkEx);
    }
  }

  // 2b. Fetch via HTTPS downloadUrl if blob not retrieved yet
  if (!pdfBlob) {
    if (!downloadUrl) {
      throw new Error("Unable to resolve PDF storage URL or signed link.");
    }

    updateProgress(50, "Downloading PDF file...");

    if (downloadUrl.startsWith("data:") || downloadUrl.startsWith("JVBERi")) {
      pdfBlob = await dataUrlToBlob(downloadUrl);
    } else {
      const response = await fetch(downloadUrl);
      if (!response.ok) {
        if (response.status === 404) {
          throw new Error("PDF file not found in storage (HTTP 404).");
        } else if (response.status === 401 || response.status === 403) {
          throw new Error("Access denied or expired download link (HTTP " + response.status + ").");
        }
        throw new Error(`Server returned HTTP status ${response.status}`);
      }
      pdfBlob = await response.blob();
    }
  }

  // Step 3: Verification
  updateProgress(75, "Verifying PDF file integrity...");

  if (!pdfBlob || pdfBlob.size <= 0) {
    throw new Error("Downloaded PDF is empty (0 bytes) or missing.");
  }

  const isValidHeader = await validatePdfHeader(pdfBlob);
  if (!isValidHeader) {
    throw new Error("Invalid PDF file: corrupted content or invalid header.");
  }

  // Step 4: Write to Cache Directory if on Native Android
  if (isNative) {
    updateProgress(85, "Saving PDF to app cache directory...");
    const base64Data = await blobToBase64(pdfBlob);

    await Filesystem.writeFile({
      path: cacheFileName,
      data: base64Data,
      directory: Directory.Cache,
      recursive: true
    });

    const cachedStat = await Filesystem.stat({
      path: cacheFileName,
      directory: Directory.Cache
    });

    if (!cachedStat || cachedStat.size <= 0) {
      throw new Error("Failed to verify cached file in app cache directory.");
    }

    const uriResult = await Filesystem.getUri({
      path: cacheFileName,
      directory: Directory.Cache
    });

    updateProgress(95, "Opening in Android PDF viewer...");

    try {
      await FileOpener.open({
        filePath: uriResult.uri,
        contentType: "application/pdf",
        openWithDefault: false
      });

      updateProgress(100, "PDF opened successfully");
      return { success: true, cachedPath: uriResult.uri, isNative: true };
    } catch (openErr: any) {
      const errStr = String(openErr?.message || openErr).toLowerCase();
      console.error("[NativePdfService] FileOpener failed:", openErr);

      if (
        errStr.includes("no app") ||
        errStr.includes("activitynotfound") ||
        errStr.includes("not found") ||
        errStr.includes("no handler") ||
        errStr.includes("cannot open")
      ) {
        throw new Error("No PDF reader installed on this device.");
      }

      throw new Error(`Failed to open PDF in Android viewer: ${openErr.message || openErr}`);
    }
  } else {
    // Web / Browser Preview Fallback
    updateProgress(95, "Opening PDF in web browser...");
    const blobObjectUrl = URL.createObjectURL(pdfBlob);
    window.open(blobObjectUrl || downloadUrl, "_blank");
    updateProgress(100, "PDF opened in browser");
    return { success: true, isNative: false };
  }
}

/**
 * Saves and opens a client-side generated PDF blob on native Android or web.
 */
export async function saveAndOpenGeneratedPdf(pdfBlob: Blob, fileName: string): Promise<void> {
  const isNative = typeof Capacitor !== "undefined" && Capacitor.isNativePlatform();
  if (isNative) {
    const base64Data = await blobToBase64(pdfBlob);
    await Filesystem.writeFile({
      path: fileName,
      data: base64Data,
      directory: Directory.Cache,
      recursive: true
    });
    const uriResult = await Filesystem.getUri({
      path: fileName,
      directory: Directory.Cache
    });
    await FileOpener.open({
      filePath: uriResult.uri,
      contentType: "application/pdf",
      openWithDefault: false
    });
  } else {
    const url = URL.createObjectURL(pdfBlob);
    const a = document.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
}
