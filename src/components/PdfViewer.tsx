import React, { useEffect, useState, useRef, useCallback, useMemo } from "react";
import {
  FileText,
  X,
  AlertTriangle,
  RefreshCw,
  ZoomIn,
  ZoomOut,
  RotateCw,
  Search,
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Smartphone,
  ArrowLeft,
  ExternalLink,
  CheckCircle2,
  Database,
  Info,
  Download
} from "lucide-react";
import { Capacitor } from "@capacitor/core";
import { getPdfDownloadUrl } from "../lib/pdfService";
import { dataUrlToBlob } from "../utils/pdfUtils";
import { getBucketName, sanitizeStoragePath } from "../lib/storageService";
import { supabase } from "../lib/supabaseClient";

// Preload PDF.js script and worker from CDN in background
export function preloadPdfJs() {
  if (typeof window === "undefined" || (window as any).pdfjsLib) {
    return;
  }
  const script = document.createElement("script");
  script.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
  script.async = true;
  script.onload = () => {
    const pdfjsLib = (window as any).pdfjsLib;
    if (pdfjsLib) {
      pdfjsLib.GlobalWorkerOptions.workerSrc =
        "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
    }
  };
  document.body.appendChild(script);
}

// React Hook to dynamically load PDF.js library
export function usePdfJs() {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if ((window as any).pdfjsLib) {
      setLoaded(true);
      return;
    }

    const script = document.createElement("script");
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
    script.async = true;
    script.onload = () => {
      const pdfjsLib = (window as any).pdfjsLib;
      if (pdfjsLib) {
        pdfjsLib.GlobalWorkerOptions.workerSrc =
          "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
        setLoaded(true);
      } else {
        setError("Failed to initialize PDF engine.");
      }
    };
    script.onerror = () => {
      setError("Failed to load PDF library from CDN.");
    };
    document.body.appendChild(script);
  }, []);

  return { loaded, error };
}

interface PdfPageProps {
  pdf: any;
  pageNum: number;
  scale: number;
  rotation: number;
  onInView: (pageNum: number) => void;
  isSearchMatch?: boolean;
}

function PdfPage({ pdf, pageNum, scale, rotation, onInView, isSearchMatch }: PdfPageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [pageSize, setPageSize] = useState<{ width: number; height: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [renderError, setRenderError] = useState<string | null>(null);
  const renderTaskRef = useRef<any>(null);

  // Fetch unscaled dimensions once to establish strict layout dimensions and prevent scroll wobbling
  useEffect(() => {
    let active = true;
    async function fetchDimensions() {
      try {
        const page = await pdf.getPage(pageNum);
        if (!active) return;
        const viewport = page.getViewport({ scale: 1, rotation });
        setPageSize({ width: viewport.width, height: viewport.height });
      } catch (err) {
        console.error(`[PdfPage] Error getting dimensions for page ${pageNum}:`, err);
      }
    }
    fetchDimensions();
    return () => {
      active = false;
    };
  }, [pdf, pageNum, rotation]);

  // IntersectionObserver for page virtualization and page tracking
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        setIsVisible(entry.isIntersecting);
        if (entry.isIntersecting) {
          onInView(pageNum);
        }
      },
      {
        root: null,
        rootMargin: "600px", // Pre-render pages 600px ahead for ultra-smooth scrolling
        threshold: 0.1
      }
    );

    observer.observe(container);
    return () => {
      observer.disconnect();
    };
  }, [pageNum, onInView]);

  // High-DPI canvas rendering when page is in or near viewport
  useEffect(() => {
    let active = true;

    if (renderTaskRef.current) {
      try {
        renderTaskRef.current.cancel();
      } catch {
        // ignore cancellation
      }
      renderTaskRef.current = null;
    }

    if (!isVisible) {
      setLoading(false);
      return;
    }

    async function renderPage() {
      try {
        setLoading(true);
        setRenderError(null);
        const page = await pdf.getPage(pageNum);
        if (!active) return;

        const viewport = page.getViewport({ scale, rotation });
        const canvas = canvasRef.current;
        if (!canvas || !active) return;

        const context = canvas.getContext("2d", { alpha: false });
        if (!context) return;

        // Razor-sharp rendering on Retina / High-DPI displays
        const dpr = window.devicePixelRatio || 1;
        canvas.height = Math.floor(viewport.height * dpr);
        canvas.width = Math.floor(viewport.width * dpr);
        canvas.style.height = `${Math.floor(viewport.height)}px`;
        canvas.style.width = `${Math.floor(viewport.width)}px`;

        context.scale(dpr, dpr);

        const renderContext = {
          canvasContext: context,
          viewport: viewport
        };

        const renderTask = page.render(renderContext);
        renderTaskRef.current = renderTask;

        await renderTask.promise;

        if (active) {
          setLoading(false);
        }
      } catch (err: any) {
        if (err.name === "RenderingCancelledException" || err.message?.includes("cancelled")) {
          return;
        }
        console.error(`[PdfPage] Render error on page ${pageNum}:`, err);
        if (active) {
          setRenderError(err.message || String(err));
          setLoading(false);
        }
      }
    }

    const timer = setTimeout(() => {
      renderPage();
    }, 10);

    return () => {
      active = false;
      clearTimeout(timer);
      if (renderTaskRef.current) {
        try {
          renderTaskRef.current.cancel();
        } catch {
          // ignore
        }
      }
    };
  }, [pdf, pageNum, scale, rotation, isVisible]);

  const targetWidth = pageSize ? Math.floor(pageSize.width * scale) : undefined;
  const targetHeight = pageSize ? Math.floor(pageSize.height * scale) : 600;

  return (
    <div
      id={`pdf-page-${pageNum}`}
      ref={containerRef}
      style={{
        width: targetWidth ? `${targetWidth}px` : "100%",
        height: `${targetHeight}px`,
        maxWidth: "100%"
      }}
      className={`relative my-4 flex items-center justify-center bg-white dark:bg-slate-900 rounded-xl shadow-lg border shrink-0 transition-all duration-150 ${
        isSearchMatch
          ? "border-amber-400 ring-4 ring-amber-400/40"
          : "border-slate-200/90 dark:border-slate-800"
      }`}
    >
      {/* Page Badge */}
      <div className="absolute top-3 left-3 z-10 text-[11px] font-black text-slate-600 dark:text-slate-300 select-none bg-white/95 dark:bg-slate-900/95 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 shadow-xs backdrop-blur-md">
        {pageNum} / {pdf.numPages}
      </div>

      {isVisible ? (
        <>
          {loading && !canvasRef.current?.width && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-100/90 dark:bg-slate-900/90 rounded-xl z-10">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mb-2"></div>
              <span className="text-xs text-slate-500 font-bold">Rendering Page {pageNum}...</span>
            </div>
          )}

          {renderError && (
            <div className="absolute inset-0 flex items-center justify-center bg-rose-50/30 dark:bg-rose-950/30 p-4 rounded-xl">
              <div className="text-rose-500 text-xs font-bold p-3 border border-dashed border-rose-400 rounded-xl bg-rose-50/90 dark:bg-slate-900">
                Failed to render page {pageNum}: {renderError}
              </div>
            </div>
          )}

          <canvas
            ref={canvasRef}
            className="rounded-lg shadow-sm block transition-opacity duration-200"
          />
        </>
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-50 dark:bg-slate-950/50 rounded-xl border border-dashed border-slate-200 dark:border-slate-800">
          <FileText className="w-8 h-8 text-slate-300 dark:text-slate-700 stroke-[1.2] mb-1 animate-pulse" />
          <span className="text-[10px] text-slate-400 font-extrabold uppercase tracking-widest">
            Page {pageNum}
          </span>
        </div>
      )}
    </div>
  );
}

interface PdfViewerProps {
  url: string;
  title: string;
  onClose: () => void;
  noteId?: string;
  storagePath?: string;
  bucket?: string;
}

export default function PdfViewer({ url, title, onClose, noteId, storagePath, bucket }: PdfViewerProps) {
  const { loaded: pdfjsLoaded, error: pdfjsLoadError } = usePdfJs();
  const [pdf, setPdf] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [downloadProgress, setDownloadProgress] = useState<number>(0);
  const [statusText, setStatusText] = useState<string>("Initializing document...");
  const [error, setError] = useState<string | null>(null);
  const [resolvedUrl, setResolvedUrl] = useState<string>("");
  const [retryTrigger, setRetryTrigger] = useState(0);

  // Debug Diagnostics State
  const [showDebugModal, setShowDebugModal] = useState<boolean>(false);
  const [diagnostics, setDiagnostics] = useState({
    bucket: bucket || "academy-connect-files",
    storagePath: storagePath || url || "",
    generatedUrl: "",
    httpStatus: "Pending",
    supabaseError: "None",
    contentType: "Unknown",
    blobSize: 0,
    magicBytes: "Pending",
    downloadStatus: "Initializing",
    platform: Capacitor.isNativePlatform() ? Capacitor.getPlatform() : "Web Browser"
  });

  // Storage key for restoring zoom & position memory
  const memoryKey = useMemo(() => {
    return `pdf_reader_memory_${storagePath || noteId || url.substring(url.lastIndexOf("/") + 1)}`;
  }, [storagePath, noteId, url]);

  // View state
  const [scale, setScale] = useState<number>(1.2);
  const [rotation, setRotation] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageInput, setPageInput] = useState<string>("1");
  const [useNativeViewer, setUseNativeViewer] = useState<boolean>(false);

  // Search state
  const [showSearch, setShowSearch] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [searchResults, setSearchResults] = useState<{ pageNum: number; count: number }[]>([]);
  const [currentMatchIndex, setCurrentMatchIndex] = useState<number>(0);

  // Container references
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  // Gesture handling state refs
  const pinchStateRef = useRef<{
    isPinching: boolean;
    startDist: number;
    startScale: number;
    focalPoint: { x: number; y: number };
  }>({
    isPinching: false,
    startDist: 0,
    startScale: 1.2,
    focalPoint: { x: 0, y: 0 }
  });

  const lastTapRef = useRef<{ time: number; x: number; y: number }>({ time: 0, x: 0, y: 0 });

  // Check platform type
  const isCapacitorNative = Capacitor.isNativePlatform();

  // Handle Page in view callback
  const handlePageInView = useCallback((pageNum: number) => {
    setCurrentPage(pageNum);
    setPageInput(String(pageNum));

    // Save page position memory
    try {
      const stored = sessionStorage.getItem(memoryKey);
      const parsed = stored ? JSON.parse(stored) : {};
      sessionStorage.setItem(
        memoryKey,
        JSON.stringify({ ...parsed, page: pageNum })
      );
    } catch {
      // ignore
    }
  }, [memoryKey]);

  // Save current scale memory
  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(memoryKey);
      const parsed = stored ? JSON.parse(stored) : {};
      sessionStorage.setItem(
        memoryKey,
        JSON.stringify({ ...parsed, scale })
      );
    } catch {
      // ignore
    }
  }, [scale, memoryKey]);

  // Scroll smoothly to target page
  const scrollToPage = useCallback((pageNum: number) => {
    if (pageNum < 1 || !pdf || pageNum > pdf.numPages) return;
    const el = document.getElementById(`pdf-page-${pageNum}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      setCurrentPage(pageNum);
      setPageInput(String(pageNum));
    }
  }, [pdf]);

  // Auto-fit to screen width
  const handleFitToWidth = useCallback(() => {
    if (!scrollContainerRef.current) return;
    const containerWidth = scrollContainerRef.current.clientWidth - 32;
    // Standard A4 page width ~ 595px
    const fitScale = Math.min(Math.max(0.6, containerWidth / 595), 2.5);
    setScale(parseFloat(fitScale.toFixed(2)));
  }, []);

  // Fit page to viewport height
  const handleFitPage = useCallback(() => {
    if (!scrollContainerRef.current) return;
    const containerHeight = scrollContainerRef.current.clientHeight - 64;
    // Standard A4 page height ~ 842px
    const fitScale = Math.min(Math.max(0.5, containerHeight / 842), 2.0);
    setScale(parseFloat(fitScale.toFixed(2)));
  }, []);

  // Restore zoom level and page position on initial load
  useEffect(() => {
    if (pdf && !loading) {
      try {
        const stored = sessionStorage.getItem(memoryKey);
        if (stored) {
          const { page, scale: savedScale } = JSON.parse(stored);
          if (savedScale && savedScale >= 0.5 && savedScale <= 4.0) {
            setScale(savedScale);
          } else {
            handleFitToWidth();
          }
          if (page && page >= 1 && page <= pdf.numPages) {
            setTimeout(() => scrollToPage(page), 150);
          }
        } else {
          handleFitToWidth();
        }
      } catch {
        handleFitToWidth();
      }
    }
  }, [pdf, loading, memoryKey, handleFitToWidth, scrollToPage]);

  // High-performance Native Touch Gesture Engine (Pinch Zoom & Double-Tap)
  useEffect(() => {
    const container = scrollContainerRef.current;
    const stage = stageRef.current;
    if (!container || !stage) return;

    let initialDist = 0;
    let initialScale = scale;
    let touchStartPinch = false;

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        e.preventDefault(); // Prevent browser zoom & scroll wobble
        touchStartPinch = true;

        const t1 = e.touches[0];
        const t2 = e.touches[1];
        initialDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
        initialScale = scale;

        const rect = container.getBoundingClientRect();
        const focalX = (t1.clientX + t2.clientX) / 2 - rect.left;
        const focalY = (t1.clientY + t2.clientY) / 2 - rect.top;

        pinchStateRef.current = {
          isPinching: true,
          startDist: initialDist,
          startScale: initialScale,
          focalPoint: { x: focalX, y: focalY }
        };
      } else if (e.touches.length === 1) {
        touchStartPinch = false;
        // Double-tap detection
        const now = Date.now();
        const t = e.touches[0];
        const last = lastTapRef.current;
        const dist = Math.hypot(t.clientX - last.x, t.clientY - last.y);

        if (now - last.time < 300 && dist < 30) {
          e.preventDefault(); // Prevent double tap zoom artifacts
          // Toggle zoom level smoothly
          if (scale > 1.4) {
            handleFitToWidth();
          } else {
            setScale(2.0);
          }
          lastTapRef.current = { time: 0, x: 0, y: 0 };
          return;
        }
        lastTapRef.current = { time: now, x: t.clientX, y: t.clientY };
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2 && touchStartPinch) {
        e.preventDefault(); // Stop wobble during pinch

        const t1 = e.touches[0];
        const t2 = e.touches[1];
        const currentDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);

        if (initialDist > 0) {
          const factor = currentDist / initialDist;
          const previewScale = Math.min(Math.max(0.5, initialScale * factor), 3.5);

          // Fast 60fps hardware accelerated visual preview without re-rendering canvases
          const ratio = previewScale / initialScale;
          stage.style.transform = `scale(${ratio})`;
          stage.style.transformOrigin = `${pinchStateRef.current.focalPoint.x}px ${pinchStateRef.current.focalPoint.y}px`;
        }
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (touchStartPinch) {
        touchStartPinch = false;
        stage.style.transform = "none";

        if (e.touches.length < 2 && pinchStateRef.current.isPinching) {
          pinchStateRef.current.isPinching = false;

          // Apply clean scale update on pinch release
          const lastScaleRatio = parseFloat(
            (stage.style.transform ? parseFloat(stage.style.transform.replace("scale(", "").replace(")", "")) : 1).toFixed(2)
          );

          if (lastScaleRatio && !isNaN(lastScaleRatio) && lastScaleRatio !== 1) {
            setScale((prev) => {
              const target = Math.min(Math.max(0.6, prev * lastScaleRatio), 3.5);
              return parseFloat(target.toFixed(2));
            });
          }
        }
      }
    };

    // Native Wheel / Ctrl + Wheel zoom support for Trackpads & Desktops
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault(); // Prevent full page browser scaling
        const delta = e.deltaY < 0 ? 0.1 : -0.1;
        setScale((prev) => {
          const next = Math.min(Math.max(0.6, prev + delta), 3.5);
          return parseFloat(next.toFixed(2));
        });
      }
    };

    container.addEventListener("touchstart", onTouchStart, { passive: false });
    container.addEventListener("touchmove", onTouchMove, { passive: false });
    container.addEventListener("touchend", onTouchEnd, { passive: true });
    container.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      container.removeEventListener("touchstart", onTouchStart);
      container.removeEventListener("touchmove", onTouchMove);
      container.removeEventListener("touchend", onTouchEnd);
      container.removeEventListener("wheel", onWheel);
    };
  }, [scale, handleFitToWidth]);

  // Desktop Keyboard Shortcuts (Arrow keys, Zoom shortcuts, Escape)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
        scrollToPage(currentPage - 1);
      } else if (e.key === "ArrowRight" || e.key === "PageDown") {
        scrollToPage(currentPage + 1);
      } else if ((e.ctrlKey || e.metaKey) && (e.key === "=" || e.key === "+")) {
        e.preventDefault();
        setScale((s) => Math.min(5.0, parseFloat((s + 0.25).toFixed(2))));
      } else if ((e.ctrlKey || e.metaKey) && e.key === "-") {
        e.preventDefault();
        setScale((s) => Math.max(0.5, parseFloat((s - 0.25).toFixed(2))));
      } else if ((e.ctrlKey || e.metaKey) && e.key === "0") {
        e.preventDefault();
        setScale(1.0);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [currentPage, scrollToPage, onClose]);

  // Resolve download URL and fetch document bytes
  useEffect(() => {
    let active = true;
    let xhr: XMLHttpRequest | null = null;

    const formatPdfError = (message: string, extra?: Record<string, unknown>) => {
      const detail = extra ? ` ${JSON.stringify(extra)}` : "";
      if (message.includes("File not found") || message.includes("404")) {
        return `File not found${detail}`;
      }
      if (message.includes("Permission") || message.includes("403") || message.includes("Access denied")) {
        return `Permission denied${detail}`;
      }
      if (message.includes("Empty file")) {
        return `Empty file${detail}`;
      }
      if (message.includes("Invalid PDF") || message.includes("Corrupted") || message.includes("PDFHeader") || message.includes("format")) {
        return `Invalid PDF${detail}`;
      }
      if (message.includes("Invalid storage path")) {
        return `Invalid storage path${detail}`;
      }
      return message || `Unable to open PDF${detail}`;
    };

    async function loadDocument() {
      try {
        setLoading(true);
        setError(null);
        setDownloadProgress(0);
        setStatusText("Resolving document link...");

        const activeBucket = getBucketName(bucket);
        const activePath = sanitizeStoragePath(storagePath || url, activeBucket);

        console.log(`================ [PDF LOAD DIAGNOSTICS] ================`);
        console.log(`- Firestore document ID / Note ID: ${noteId || "N/A"}`);
        console.log(`- Bucket: ${activeBucket}`);
        console.log(`- Storage Path: ${activePath || url}`);

        // 1. Resolve direct signed or public HTTPS URL
        let dlUrl = "";
        try {
          dlUrl = await getPdfDownloadUrl(url, activeBucket);
          if (!active) return;
          setResolvedUrl(dlUrl);
          console.log(`- Generated URL: ${dlUrl}`);
        } catch (resErr: any) {
          console.warn(`[PdfViewer] Failed to resolve signed/public URL:`, resErr);
        }

        // 2. Cache Storage API check for instant offline re-access
        const cacheSupported = "caches" in window;
        let pdfBlob: Blob | null = null;

        if (cacheSupported) {
          try {
            const cache = await caches.open("student-pdf-cache");
            const cachedResponse = await cache.match(url);
            if (cachedResponse) {
              const b = await cachedResponse.blob();
              if (b && b.size > 0) {
                console.log(`[PdfViewer Cache] Found valid cached blob (${b.size} bytes).`);
                setStatusText("Opening cached PDF document...");
                pdfBlob = b;
              }
            }
          } catch (e) {
            console.warn(`[PdfViewer Cache] Cache lookup error:`, e);
          }
        }

        // 3. Try direct Supabase SDK download if not cached
        if (!pdfBlob && activePath && !url.startsWith("data:") && !url.startsWith("blob:")) {
          try {
            setStatusText("Fetching from Supabase Storage...");
            console.log("=== [STORAGE LOAD AUDIT] ===");
            console.log("bucket:", activeBucket);
            console.log("storagePath:", activePath);

            const { data: sdkData, error: sdkErr } = await supabase.storage.from(activeBucket).download(activePath);

            console.log("error:", sdkErr);
            console.log("data:", sdkData);

            if (!sdkErr && sdkData && sdkData.size > 0) {
              console.log(`[PDF LOAD DIAGNOSTICS] Direct SDK download succeeded (${sdkData.size} bytes).`);
              pdfBlob = sdkData;
            } else {
              console.warn(`[PDF LOAD DIAGNOSTICS] download() returned error or empty blob. Attempting createSignedUrl fallback...`);
              const { data: signedData, error: signedErr } = await supabase.storage
                .from(activeBucket)
                .createSignedUrl(activePath, 3600);

              if (!signedErr && signedData?.signedUrl) {
                setResolvedUrl(signedData.signedUrl);
                const signedRes = await fetch(signedData.signedUrl);
                if (signedRes.ok) {
                  const blobFromSigned = await signedRes.blob();
                  if (blobFromSigned && blobFromSigned.size > 0) {
                    console.log(`[PDF LOAD DIAGNOSTICS] Signed URL download succeeded (${blobFromSigned.size} bytes).`);
                    pdfBlob = blobFromSigned;
                  }
                }
              }
            }
          } catch (sdkEx) {
            console.warn(`[PdfViewer] Direct SDK download exception:`, sdkEx);
          }
        }

        // 4. Download file via HTTPS URL if still not retrieved
        if (!pdfBlob) {
          if (!dlUrl) {
            throw new Error("Unable to resolve PDF storage URL.");
          }

          setStatusText("Downloading document… 0%");

          if (dlUrl.startsWith("data:") || dlUrl.startsWith("JVBERi")) {
            try {
              pdfBlob = await dataUrlToBlob(dlUrl);
              const blobObjUrl = URL.createObjectURL(pdfBlob);
              setResolvedUrl(blobObjUrl);
            } catch (e: any) {
              throw new Error(`Failed to read inline PDF document: ${e.message}`);
            }
          } else if (dlUrl.startsWith("blob:")) {
            try {
              pdfBlob = await new Promise<Blob>((resolve, reject) => {
                const blobXhr = new XMLHttpRequest();
                blobXhr.open("GET", dlUrl, true);
                blobXhr.responseType = "blob";
                blobXhr.onload = () => {
                  if (blobXhr.response && blobXhr.response.size > 0) {
                    resolve(blobXhr.response);
                  } else {
                    reject(new Error("Empty blob response"));
                  }
                };
                blobXhr.onerror = () => reject(new Error("Failed to read blob URL"));
                blobXhr.send();
              });
            } catch (e: any) {
              try {
                const res = await fetch(dlUrl);
                pdfBlob = await res.blob();
              } catch (fetchErr: any) {
                throw new Error(`Failed to read inline PDF document: ${e.message || fetchErr.message}`);
              }
            }
          } else {
            try {
              pdfBlob = await new Promise<Blob>((resolve, reject) => {
                xhr = new XMLHttpRequest();
                xhr.open("GET", dlUrl, true);
                xhr.responseType = "blob";

                xhr.onprogress = (event) => {
                  if (event.lengthComputable && active) {
                    const percent = Math.round((event.loaded / event.total) * 100);
                    setDownloadProgress(percent);
                    setStatusText(`Downloading document… ${percent}%`);
                  }
                };

                xhr.onload = () => {
                  const status = xhr?.status || 0;
                  const contentType = xhr?.getResponseHeader("content-type") || "unknown";

                  if (contentType && !contentType.toLowerCase().includes("application/pdf") && !contentType.toLowerCase().includes("octet-stream")) {
                    reject(new Error(`Unexpected Content-Type: ${contentType}`));
                    return;
                  }

                  if ((status >= 200 && status < 300) || status === 0) {
                    if (xhr?.response && xhr.response.size > 0) {
                      resolve(xhr.response);
                    } else {
                      reject(new Error("Received empty response from storage (0 bytes)."));
                    }
                  } else {
                    reject(new Error(`Server returned HTTP status ${status}`));
                  }
                };

                xhr.onerror = () => {
                  reject(new Error("Network connection error. Failed to download file."));
                };

                xhr.ontimeout = () => {
                  reject(new Error("Network request timed out."));
                };

                xhr.send();
              });
            } catch (xhrErr: any) {
              try {
                const fetchRes = await fetch(dlUrl);
                if (!fetchRes.ok) {
                  throw new Error(`Server returned HTTP status ${fetchRes.status}`);
                }
                pdfBlob = await fetchRes.blob();
              } catch (fetchErr: any) {
                throw new Error(fetchErr.message || xhrErr.message || "Failed to download PDF document.");
              }
            }
          }
        }

        if (!active) return;

        if (!pdfBlob || pdfBlob.size <= 0) {
          throw new Error("File not found in storage or received 0 bytes.");
        }

        // Verify PDF magic header bytes (%PDF)
        let magicText = "";
        try {
          const magicSlice = pdfBlob.slice(0, 5);
          magicText = await magicSlice.text();
          if (!magicText.startsWith("%PDF") && !magicText.startsWith("JVBER")) {
            const errorSlice = pdfBlob.slice(0, 500);
            const errorText = await errorSlice.text();
            if (errorText.trim().startsWith("{")) {
              try {
                const parsed = JSON.parse(errorText);
                const errMsg = parsed.message || parsed.error || errorText;
                setDiagnostics((d) => ({ ...d, supabaseError: errMsg, magicBytes: "JSON Error" }));
                throw new Error(`Supabase Storage Error: ${errMsg}`);
              } catch (e: any) {
                if (e.message?.includes("Supabase Storage Error")) throw e;
              }
            }
            setDiagnostics((d) => ({ ...d, magicBytes: magicText.substring(0, 10) }));
            throw new Error(`Invalid PDF document format: header does not match %PDF.`);
          }
        } catch (magicErr: any) {
          if (magicErr.message?.includes("Invalid PDF") || magicErr.message?.includes("Supabase Storage Error")) throw magicErr;
        }

        setDiagnostics({
          bucket: activeBucket,
          storagePath: activePath || url,
          generatedUrl: dlUrl || resolvedUrl || url,
          httpStatus: "200 OK",
          supabaseError: "None",
          contentType: pdfBlob.type || "application/pdf",
          blobSize: pdfBlob.size,
          magicBytes: magicText || "%PDF",
          downloadStatus: "Downloaded & Validated",
          platform: isCapacitorNative ? Capacitor.getPlatform() : "Web Browser"
        });

        // Cache valid blob
        if (cacheSupported && dlUrl && !dlUrl.startsWith("data:") && !dlUrl.startsWith("blob:")) {
          try {
            const cache = await caches.open("student-pdf-cache");
            await cache.put(
              url,
              new Response(pdfBlob.slice(0), {
                headers: { "Content-Type": "application/pdf" }
              })
            );
          } catch {
            // ignore
          }
        }

        const blobUrl = URL.createObjectURL(pdfBlob);
        setResolvedUrl(blobUrl);

        // Load PDF.js engine
        setStatusText("Initializing PDF engine...");
        let pdfjsLib = (window as any).pdfjsLib;
        if (!pdfjsLib) {
          for (let i = 0; i < 25; i++) {
            await new Promise((res) => setTimeout(res, 200));
            pdfjsLib = (window as any).pdfjsLib;
            if (pdfjsLib) break;
          }
        }

        if (!pdfjsLib) {
          throw new Error("PDF rendering engine (pdf.js) failed to load from CDN.");
        }

        setStatusText("Rendering document pages...");
        const arrayBuffer = await pdfBlob.arrayBuffer();
        const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
        const pdfDoc = await loadingTask.promise;

        if (active) {
          setPdf(pdfDoc);
          setLoading(false);
        }
      } catch (err: any) {
        console.error(`[PdfViewer] Failed to load PDF:`, err);
        if (active) {
          const msg = err.message || "";
          setDiagnostics((d) => ({
            ...d,
            supabaseError: msg,
            downloadStatus: "Failed: " + msg,
            httpStatus: msg.includes("400") ? "400 Bad Request" : msg.includes("404") ? "404 Not Found" : "Error"
          }));
          setError(formatPdfError(msg));
          setLoading(false);
        }
      }
    }

    loadDocument();

    return () => {
      active = false;
      if (xhr) {
        xhr.abort();
      }
    };
  }, [pdfjsLoaded, pdfjsLoadError, url, retryTrigger, isCapacitorNative]);

  // Execute Search across all pages
  const handlePerformSearch = async () => {
    if (!searchQuery.trim() || !pdf) return;
    try {
      setIsSearching(true);
      const query = searchQuery.trim().toLowerCase();
      const matches: { pageNum: number; count: number }[] = [];

      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const text = textContent.items.map((item: any) => item.str).join(" ").toLowerCase();

        if (text.includes(query)) {
          const occurrences = text.split(query).length - 1;
          matches.push({ pageNum: i, count: occurrences });
        }
      }

      setSearchResults(matches);
      setCurrentMatchIndex(0);
      setIsSearching(false);

      if (matches.length > 0) {
        scrollToPage(matches[0].pageNum);
      }
    } catch (err) {
      console.error("[PdfViewer] Search error:", err);
      setIsSearching(false);
    }
  };

  const handleNextMatch = () => {
    if (searchResults.length === 0) return;
    const nextIdx = (currentMatchIndex + 1) % searchResults.length;
    setCurrentMatchIndex(nextIdx);
    scrollToPage(searchResults[nextIdx].pageNum);
  };

  const handlePrevMatch = () => {
    if (searchResults.length === 0) return;
    const prevIdx = (currentMatchIndex - 1 + searchResults.length) % searchResults.length;
    setCurrentMatchIndex(prevIdx);
    scrollToPage(searchResults[prevIdx].pageNum);
  };

  const handleRetry = () => {
    setRetryTrigger((prev) => prev + 1);
  };

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-slate-950 text-white select-none animate-fadeIn overflow-hidden">
      {/* --- Top Header Toolbar & Controls --- */}
      <div className="flex flex-col border-b border-slate-800/80 bg-slate-900 shrink-0 shadow-md">
        <div className="flex items-center justify-between px-3 py-2.5 sm:px-4 sm:py-3 gap-2">
          {/* Back button & Title */}
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <button
              onClick={onClose}
              className="p-2 hover:bg-slate-800 active:bg-slate-700 text-slate-300 hover:text-white rounded-xl transition-all cursor-pointer border border-slate-700/80 shrink-0 flex items-center gap-1"
              title="Back"
            >
              <ArrowLeft className="w-4 h-4" />
              <span className="text-xs font-bold hidden sm:inline">Back</span>
            </button>

            <div className="flex flex-col min-w-0">
              <h2 className="text-xs sm:text-sm font-black text-slate-100 truncate">
                {title}
              </h2>
              {pdf && (
                <span className="text-[10px] text-slate-400 font-semibold truncate">
                  Page {currentPage} of {pdf.numPages}
                </span>
              )}
            </div>
          </div>

          {/* Controls toolbar */}
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            {/* Search toggle button */}
            {pdf && (
              <button
                onClick={() => setShowSearch((prev) => !prev)}
                className={`p-2 rounded-xl transition-all cursor-pointer border ${
                  showSearch
                    ? "bg-blue-600 text-white border-blue-500"
                    : "hover:bg-slate-800 text-slate-300 hover:text-white border-slate-700/80"
                }`}
                title="Search in PDF"
              >
                <Search className="w-4 h-4" />
              </button>
            )}

            {/* Rotation control */}
            {pdf && (
              <button
                onClick={() => setRotation((r) => (r + 90) % 360)}
                className="p-2 hover:bg-slate-800 text-slate-300 hover:text-white rounded-xl transition-all border border-slate-700/80 cursor-pointer hidden sm:flex"
                title="Rotate 90°"
              >
                <RotateCw className="w-4 h-4" />
              </button>
            )}

            {/* Native viewer switch mode toggle */}
            {resolvedUrl && (
              <button
                onClick={() => setUseNativeViewer((prev) => !prev)}
                className={`p-2 rounded-xl transition-all cursor-pointer border hidden md:flex items-center gap-1 text-xs font-bold ${
                  useNativeViewer
                    ? "bg-emerald-600 text-white border-emerald-500"
                    : "hover:bg-slate-800 text-slate-300 hover:text-white border-slate-700/80"
                }`}
                title={useNativeViewer ? "Switch to Reader" : "Switch to Device Engine"}
              >
                <Smartphone className="w-4 h-4" />
                <span>{useNativeViewer ? "Reader" : "Native"}</span>
              </button>
            )}

            {/* Professional Zoom Control Suite */}
            {pdf && !useNativeViewer && (
              <div className="flex items-center bg-slate-800/90 rounded-xl p-0.5 border border-slate-700/80 text-xs font-semibold">
                <button
                  onClick={() => setScale((s) => Math.max(0.5, parseFloat((s - 0.25).toFixed(2))))}
                  className="p-1.5 hover:text-white text-slate-300 rounded-lg transition cursor-pointer"
                  title="Zoom Out"
                >
                  <ZoomOut className="w-3.5 h-3.5" />
                </button>

                <select
                  value={scale}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    if (!isNaN(val)) setScale(val);
                  }}
                  className="bg-transparent text-[11px] font-black text-slate-200 px-1 py-0.5 focus:outline-hidden cursor-pointer"
                  title="Zoom Percentage"
                >
                  <option value={0.5} className="bg-slate-900 text-white">50%</option>
                  <option value={0.75} className="bg-slate-900 text-white">75%</option>
                  <option value={1.0} className="bg-slate-900 text-white">100%</option>
                  <option value={1.25} className="bg-slate-900 text-white">125%</option>
                  <option value={1.5} className="bg-slate-900 text-white">150%</option>
                  <option value={2.0} className="bg-slate-900 text-white">200%</option>
                  <option value={3.0} className="bg-slate-900 text-white">300%</option>
                  <option value={4.0} className="bg-slate-900 text-white">400%</option>
                  <option value={5.0} className="bg-slate-900 text-white">500%</option>
                </select>

                <button
                  onClick={() => setScale((s) => Math.min(5.0, parseFloat((s + 0.25).toFixed(2))))}
                  className="p-1.5 hover:text-white text-slate-300 rounded-lg transition cursor-pointer"
                  title="Zoom In"
                >
                  <ZoomIn className="w-3.5 h-3.5" />
                </button>

                <div className="h-4 w-[1px] bg-slate-700 my-auto mx-0.5 hidden sm:block"></div>

                <button
                  onClick={handleFitToWidth}
                  className="p-1.5 hover:text-white text-slate-400 hover:bg-slate-700/60 rounded-lg transition cursor-pointer hidden sm:block"
                  title="Fit Width"
                >
                  <Maximize2 className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {/* Direct Download Button */}
            {resolvedUrl && (
              <a
                href={resolvedUrl}
                download={`${title.replace(/\s+/g, "_")}.pdf`}
                target="_blank"
                rel="noopener noreferrer"
                className="p-2 hover:bg-slate-800 text-emerald-400 hover:text-emerald-300 rounded-xl transition-all border border-slate-700/80 cursor-pointer flex items-center gap-1"
                title="Download PDF"
              >
                <Download className="w-4 h-4" />
                <span className="text-xs font-bold hidden lg:inline">Download</span>
              </a>
            )}

            {/* Open in New Tab */}
            {resolvedUrl && (
              <a
                href={resolvedUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="p-2 hover:bg-slate-800 text-slate-300 hover:text-white rounded-xl transition-all border border-slate-700/80 cursor-pointer flex items-center gap-1"
                title="Open in New Tab"
              >
                <ExternalLink className="w-4 h-4 text-slate-300" />
              </a>
            )}
          </div>
        </div>

        {/* Search drawer bar */}
        {showSearch && pdf && (
          <div className="flex flex-wrap items-center justify-between px-3 py-2 bg-slate-950 border-t border-slate-800 gap-2 animate-fadeIn">
            <div className="flex items-center gap-2 flex-1 min-w-[200px]">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handlePerformSearch()}
                placeholder="Search text in PDF..."
                className="w-full px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-hidden focus:border-blue-500"
              />
              <button
                onClick={handlePerformSearch}
                disabled={isSearching}
                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-xs cursor-pointer transition disabled:opacity-50 shrink-0"
              >
                {isSearching ? "Finding..." : "Find"}
              </button>
            </div>

            {searchResults.length > 0 && (
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-[11px] font-bold text-amber-400">
                  Match {currentMatchIndex + 1} of {searchResults.length}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={handlePrevMatch}
                    className="p-1.5 hover:bg-slate-800 text-slate-300 rounded-lg border border-slate-700 cursor-pointer"
                    title="Previous match"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={handleNextMatch}
                    className="p-1.5 hover:bg-slate-800 text-slate-300 rounded-lg border border-slate-700 cursor-pointer"
                    title="Next match"
                  >
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Page Jump & Navigation bar */}
        {pdf && !useNativeViewer && (
          <div className="flex items-center justify-between px-3 py-1.5 bg-slate-950/90 border-t border-slate-800/80 text-xs">
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => scrollToPage(currentPage - 1)}
                disabled={currentPage <= 1}
                className="p-1 hover:bg-slate-800 text-slate-300 disabled:opacity-30 rounded-md cursor-pointer transition"
                title="Previous Page"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>

              <div className="flex items-center gap-1 font-semibold text-slate-300">
                <span>Page</span>
                <input
                  type="number"
                  min={1}
                  max={pdf.numPages}
                  value={pageInput}
                  onChange={(e) => setPageInput(e.target.value)}
                  onBlur={() => scrollToPage(Number(pageInput))}
                  onKeyDown={(e) => e.key === "Enter" && scrollToPage(Number(pageInput))}
                  className="w-12 px-1.5 py-0.5 bg-slate-900 border border-slate-700 rounded-md text-center text-xs font-black text-white focus:outline-hidden focus:border-blue-500"
                />
                <span>of {pdf.numPages}</span>
              </div>

              <button
                onClick={() => scrollToPage(currentPage + 1)}
                disabled={currentPage >= pdf.numPages}
                className="p-1 hover:bg-slate-800 text-slate-300 disabled:opacity-30 rounded-md cursor-pointer transition"
                title="Next Page"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleFitToWidth}
                className="text-[10px] text-slate-400 hover:text-slate-200 font-bold bg-slate-800 px-2 py-0.5 rounded border border-slate-700 transition cursor-pointer"
              >
                Fit Width
              </button>
              <button
                onClick={handleFitPage}
                className="text-[10px] text-slate-400 hover:text-slate-200 font-bold bg-slate-800 px-2 py-0.5 rounded border border-slate-700 transition cursor-pointer hidden sm:inline"
              >
                Fit Page
              </button>
            </div>
          </div>
        )}
      </div>

      {/* --- Main Ultra-Smooth Scroll Stage --- */}
      <div
        ref={scrollContainerRef}
        style={{
          WebkitOverflowScrolling: "touch",
          touchAction: "pan-x pan-y"
        }}
        className="flex-1 overflow-auto p-3 sm:p-6 bg-slate-950 flex flex-col items-center justify-start relative w-full h-full"
      >
        {/* Loading Indicator */}
        {loading && (
          <div className="my-auto flex flex-col items-center justify-center p-8 gap-4 text-center">
            <div className="relative flex items-center justify-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
              <FileText className="absolute w-5 h-5 text-blue-400 animate-pulse" />
            </div>
            <div className="flex flex-col items-center max-w-sm">
              <p className="font-bold text-sm text-slate-200">{statusText}</p>
              {downloadProgress > 0 && downloadProgress < 100 && (
                <div className="w-52 h-2 bg-slate-800 rounded-full overflow-hidden mt-3 border border-slate-700">
                  <div
                    className="h-full bg-blue-500 transition-all duration-300"
                    style={{ width: `${downloadProgress}%` }}
                  />
                </div>
              )}
              <p className="text-[11px] text-slate-400 mt-2.5 leading-relaxed">
                Opening PDF document safely with high-performance rendering engine.
              </p>
            </div>
          </div>
        )}

        {/* Error Handling View */}
        {error && (
          <div className="my-auto flex flex-col items-center justify-center p-6 sm:p-8 text-center max-w-md mx-auto gap-4 bg-slate-900 rounded-2xl border border-rose-500/20 shadow-xl">
            <div className="bg-rose-500/10 p-3.5 rounded-full border border-rose-500/20 text-rose-400">
              <AlertTriangle className="w-8 h-8" />
            </div>
            <div>
              <h3 className="font-bold text-base text-rose-400">{error}</h3>
              <p className="text-xs text-slate-400 mt-2 leading-relaxed">
                We encountered an issue opening this chapter note PDF. Please verify your internet connection and try retrying.
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-3 mt-2">
              <button
                onClick={handleRetry}
                className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white rounded-xl shadow-md cursor-pointer transition-all active:scale-95"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Retry Loading</span>
              </button>
            </div>
          </div>
        )}

        {/* Native Device Reader Mode */}
        {!loading && !error && useNativeViewer && resolvedUrl && (
          <div className="w-full h-full flex-1 rounded-xl overflow-hidden bg-white shadow-xl border border-slate-800">
            <iframe
              src={resolvedUrl}
              title={title}
              className="w-full h-full border-none"
            />
          </div>
        )}

        {/* Interactive Web PDF.js Reader Engine Stage */}
        {!loading && !error && pdf && !useNativeViewer && (
          <div
            ref={stageRef}
            className="flex flex-col items-center gap-2 transition-transform duration-75 origin-top"
          >
            {Array.from({ length: pdf.numPages }, (_, i) => {
              const pageNum = i + 1;
              const isMatch = searchResults.some((m) => m.pageNum === pageNum);
              return (
                <PdfPage
                  key={pageNum}
                  pdf={pdf}
                  pageNum={pageNum}
                  scale={scale}
                  rotation={rotation}
                  onInView={handlePageInView}
                  isSearchMatch={isMatch}
                />
              );
            })}
          </div>
        )}
      </div>

      {/* --- Diagnostic Info Overlay --- */}
      {showDebugModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-fadeIn">
          <div className="bg-slate-900 border border-amber-500/30 rounded-2xl p-5 sm:p-6 max-w-lg w-full shadow-2xl text-slate-100 relative max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-4">
              <div className="flex items-center gap-2 text-amber-400 font-bold text-base">
                <Info className="w-5 h-5 text-amber-400" />
                <span>PDF Diagnostic Info</span>
              </div>
              <button
                onClick={() => setShowDebugModal(false)}
                className="p-1.5 hover:bg-slate-800 text-slate-400 hover:text-white rounded-lg transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs font-mono">
              <div className="bg-slate-950 p-3 rounded-xl border border-slate-800">
                <p className="text-slate-400 text-[10px] uppercase font-sans font-bold">Storage Bucket</p>
                <p className="text-amber-300 font-bold mt-0.5 break-all">{diagnostics.bucket}</p>
              </div>

              <div className="bg-slate-950 p-3 rounded-xl border border-slate-800">
                <p className="text-slate-400 text-[10px] uppercase font-sans font-bold">Storage Path</p>
                <p className="text-slate-200 mt-0.5 break-all">{diagnostics.storagePath}</p>
              </div>

              <div className="bg-slate-950 p-3 rounded-xl border border-slate-800">
                <p className="text-slate-400 text-[10px] uppercase font-sans font-bold">Generated View / Download URL</p>
                <p className="text-blue-400 mt-0.5 break-all line-clamp-3">{diagnostics.generatedUrl || "N/A"}</p>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="bg-slate-950 p-3 rounded-xl border border-slate-800">
                  <p className="text-slate-400 text-[10px] uppercase font-sans font-bold">HTTP Status</p>
                  <p className={`font-bold mt-0.5 ${diagnostics.httpStatus.includes("200") ? "text-emerald-400" : "text-rose-400"}`}>
                    {diagnostics.httpStatus}
                  </p>
                </div>
                <div className="bg-slate-950 p-3 rounded-xl border border-slate-800">
                  <p className="text-slate-400 text-[10px] uppercase font-sans font-bold">Blob Size</p>
                  <p className="text-slate-200 font-bold mt-0.5">
                    {diagnostics.blobSize > 0 ? `${diagnostics.blobSize} B (${(diagnostics.blobSize / 1024).toFixed(1)} KB)` : "0 Bytes"}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="bg-slate-950 p-3 rounded-xl border border-slate-800">
                  <p className="text-slate-400 text-[10px] uppercase font-sans font-bold">Content-Type</p>
                  <p className="text-slate-200 mt-0.5">{diagnostics.contentType}</p>
                </div>
                <div className="bg-slate-950 p-3 rounded-xl border border-slate-800">
                  <p className="text-slate-400 text-[10px] uppercase font-sans font-bold">Magic Bytes</p>
                  <p className={`font-bold mt-0.5 ${diagnostics.magicBytes.startsWith("%PDF") ? "text-emerald-400" : "text-amber-400"}`}>
                    {diagnostics.magicBytes}
                  </p>
                </div>
              </div>

              <div className="bg-slate-950 p-3 rounded-xl border border-slate-800">
                <p className="text-slate-400 text-[10px] uppercase font-sans font-bold">Download / Cache Status</p>
                <p className="text-slate-200 mt-0.5 font-sans font-semibold">{diagnostics.downloadStatus}</p>
              </div>

              <div className="bg-slate-950 p-3 rounded-xl border border-slate-800">
                <p className="text-slate-400 text-[10px] uppercase font-sans font-bold">Supabase / Network Error</p>
                <p className={`mt-0.5 break-all ${diagnostics.supabaseError === "None" ? "text-slate-400" : "text-rose-400 font-bold"}`}>
                  {diagnostics.supabaseError}
                </p>
              </div>

              <div className="bg-slate-950 p-3 rounded-xl border border-slate-800">
                <p className="text-slate-400 text-[10px] uppercase font-sans font-bold">Platform / Engine</p>
                <p className="text-slate-300 mt-0.5 font-sans font-semibold">{diagnostics.platform}</p>
              </div>
            </div>

            <div className="mt-5 flex justify-end">
              <button
                onClick={() => setShowDebugModal(false)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs rounded-xl transition cursor-pointer"
              >
                Close Debug Panel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
