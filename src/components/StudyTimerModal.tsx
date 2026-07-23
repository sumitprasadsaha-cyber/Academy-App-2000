import React, { useState, useEffect, useRef } from "react";
import {
  Timer as TimerIcon,
  Clock,
  Play,
  Pause,
  RotateCcw,
  X,
  Bell,
  Volume2,
  Flag,
  ArrowLeftRight,
  Plus,
  Minus,
  Sparkles,
  Check,
  VolumeX
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";

interface StudyTimerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onTimerRunningChange?: (isRunning: boolean) => void;
}

type Mode = "timer" | "stopwatch";

export default function StudyTimerModal({ isOpen, onClose, onTimerRunningChange }: StudyTimerModalProps) {
  const [mode, setMode] = useState<Mode>("timer");

  // --- TIMER STATE ---
  const [timerInitialSeconds, setTimerInitialSeconds] = useState<number>(25 * 60); // Default 25 min (Pomodoro)
  const [timerSecondsLeft, setTimerSecondsLeft] = useState<number>(25 * 60);
  const [isTimerRunning, setIsTimerRunning] = useState<boolean>(false);
  const [isAlarmRinging, setIsAlarmRinging] = useState<boolean>(false);

  // Custom setup inputs (in minutes)
  const [customMinutes, setCustomMinutes] = useState<number>(25);

  // --- STOPWATCH STATE ---
  const [stopwatchMs, setStopwatchMs] = useState<number>(0);
  const [isStopwatchRunning, setIsStopwatchRunning] = useState<boolean>(false);
  const [laps, setLaps] = useState<number[]>([]);

  // Refs for interval loops & audio
  const timerIntervalRef = useRef<any>(null);
  const stopwatchIntervalRef = useRef<any>(null);
  const alarmIntervalRef = useRef<any>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  // Notify parent component if timer/stopwatch is currently active/running
  const isRunning = isTimerRunning || isStopwatchRunning;
  useEffect(() => {
    onTimerRunningChange?.(isRunning);
  }, [isRunning, onTimerRunningChange]);

  const stopAlarm = () => {
    setIsAlarmRinging(false);
    if (alarmIntervalRef.current) {
      clearInterval(alarmIntervalRef.current);
      alarmIntervalRef.current = null;
    }
    if (audioCtxRef.current) {
      try {
        if (audioCtxRef.current.state !== "closed") {
          audioCtxRef.current.close();
        }
      } catch (e) {
        console.error("Audio close error:", e);
      }
      audioCtxRef.current = null;
    }
  };

  // Sound chime producer
  const triggerAlarm = () => {
    // Request notification permissions if supported
    if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }

    // Fire browser desktop notification if granted
    if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
      try {
        new Notification("Study Timer Finished!", {
          body: "Your study session countdown has completed.",
        });
      } catch (e) {
        // ignore
      }
    }

    const playBeep = () => {
      try {
        if (audioCtxRef.current && audioCtxRef.current.state !== "closed") {
          audioCtxRef.current.close();
        }

        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        if (!AudioContextClass) return;
        const ctx = new AudioContextClass();
        audioCtxRef.current = ctx;

        if (ctx.state === "suspended") {
          ctx.resume();
        }

        const emitNote = (delay: number, freq: number, dur: number) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = "sine";
          osc.frequency.value = freq;
          gain.gain.setValueAtTime(0.3, ctx.currentTime + delay);
          gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + delay + dur);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(ctx.currentTime + delay);
          osc.stop(ctx.currentTime + delay + dur);
        };

        const t = 0;
        emitNote(t, 523.25, 0.2); // C5
        emitNote(t + 0.2, 659.25, 0.2); // E5
        emitNote(t + 0.4, 783.99, 0.25); // G5
        emitNote(t + 0.7, 1046.5, 0.4); // C6
      } catch (e) {
        console.error("Audio error:", e);
      }

      if (typeof navigator !== "undefined" && navigator.vibrate) {
        try {
          navigator.vibrate([300, 150, 300, 150, 400]);
        } catch (e) {
          // ignore
        }
      }
    };

    stopAlarm();
    setIsAlarmRinging(true);
    playBeep();
    alarmIntervalRef.current = setInterval(playBeep, 2500);
  };

  // --- TIMER EFFECT ---
  useEffect(() => {
    if (isTimerRunning) {
      timerIntervalRef.current = setInterval(() => {
        setTimerSecondsLeft((prev) => {
          if (prev <= 1) {
            clearInterval(timerIntervalRef.current);
            setIsTimerRunning(false);
            triggerAlarm();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } else {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    }

    return () => {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    };
  }, [isTimerRunning]);

  // --- STOPWATCH EFFECT ---
  useEffect(() => {
    if (isStopwatchRunning) {
      const startTime = Date.now() - stopwatchMs;
      stopwatchIntervalRef.current = setInterval(() => {
        setStopwatchMs(Date.now() - startTime);
      }, 30);
    } else {
      if (stopwatchIntervalRef.current) clearInterval(stopwatchIntervalRef.current);
    }

    return () => {
      if (stopwatchIntervalRef.current) clearInterval(stopwatchIntervalRef.current);
    };
  }, [isStopwatchRunning]);

  useEffect(() => {
    return () => {
      stopAlarm();
    };
  }, []);

  // --- TIMER CONTROLS ---
  const handleStartTimer = () => {
    if (timerSecondsLeft <= 0) {
      setTimerSecondsLeft(timerInitialSeconds);
    }
    stopAlarm();
    setIsTimerRunning(true);
  };

  const handlePauseTimer = () => {
    setIsTimerRunning(false);
  };

  const handleResetTimer = () => {
    setIsTimerRunning(false);
    stopAlarm();
    setTimerSecondsLeft(timerInitialSeconds);
  };

  const handleSetPreset = (minutes: number) => {
    const secs = minutes * 60;
    setIsTimerRunning(false);
    stopAlarm();
    setTimerInitialSeconds(secs);
    setTimerSecondsLeft(secs);
    setCustomMinutes(minutes);
  };

  const handleApplyCustomMinutes = (mins: number) => {
    const valid = Math.max(1, Math.min(300, mins));
    setCustomMinutes(valid);
    const secs = valid * 60;
    setIsTimerRunning(false);
    stopAlarm();
    setTimerInitialSeconds(secs);
    setTimerSecondsLeft(secs);
  };

  // --- STOPWATCH CONTROLS ---
  const handleStartStopwatch = () => {
    setIsStopwatchRunning(true);
  };

  const handlePauseStopwatch = () => {
    setIsStopwatchRunning(false);
  };

  const handleResetStopwatch = () => {
    setIsStopwatchRunning(false);
    setStopwatchMs(0);
    setLaps([]);
  };

  const handleAddLap = () => {
    setLaps((prev) => [stopwatchMs, ...prev]);
  };

  // Format helper for Timer
  const formatTimerDisplay = (seconds: number) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hrs > 0) {
      return `${String(hrs).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
    }
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  };

  // Format helper for Stopwatch
  const formatStopwatchDisplay = (ms: number) => {
    const totalSecs = Math.floor(ms / 1000);
    const hrs = Math.floor(totalSecs / 3600);
    const mins = Math.floor((totalSecs % 3600) / 60);
    const secs = totalSecs % 60;
    const hundredths = Math.floor((ms % 1000) / 10);

    const pad = (n: number) => String(n).padStart(2, "0");

    if (hrs > 0) {
      return {
        main: `${pad(hrs)}:${pad(mins)}:${pad(secs)}`,
        ms: pad(hundredths)
      };
    }
    return {
      main: `${pad(mins)}:${pad(secs)}`,
      ms: pad(hundredths)
    };
  };

  // Circular calculations
  const radius = 90;
  const circumference = 2 * Math.PI * radius;

  // Timer Progress fraction (1.0 -> 0.0)
  const timerProgress = timerInitialSeconds > 0 ? timerSecondsLeft / timerInitialSeconds : 0;
  const timerStrokeDashoffset = circumference * (1 - timerProgress);

  // Stopwatch Progress fraction (spins every 60s)
  const swSeconds = (stopwatchMs / 1000) % 60;
  const swProgress = swSeconds / 60;
  const swStrokeDashoffset = circumference * (1 - swProgress);

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
        <motion.div
          initial={{ opacity: 0, scale: 0.92, y: 16 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.92, y: 16 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          className="relative w-full max-w-sm sm:max-w-md bg-white dark:bg-[#111827] rounded-3xl shadow-2xl border border-slate-200/80 dark:border-slate-800 overflow-hidden flex flex-col"
        >
          {/* Header */}
          <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800/80 flex items-center justify-between bg-slate-50/50 dark:bg-[#0d131f]/50">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 border border-blue-100 dark:border-blue-900/50">
                {mode === "timer" ? <TimerIcon className="w-5 h-5" /> : <Clock className="w-5 h-5" />}
              </div>
              <div>
                <h3 className="text-sm font-black text-slate-800 dark:text-slate-100 tracking-tight">
                  {mode === "timer" ? "Study Timer" : "Practice Stopwatch"}
                </h3>
                <p className="text-[11px] font-medium text-slate-600 dark:text-slate-400">
                  {mode === "timer" ? "Countdown & Alarm" : "Elapsed Time & Laps"}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {/* Toggle Mode Button */}
              <button
                onClick={() => {
                  stopAlarm();
                  setMode(mode === "timer" ? "stopwatch" : "timer");
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-xl transition-all cursor-pointer border border-slate-200/60 dark:border-slate-700"
                title={`Switch to ${mode === "timer" ? "Stopwatch" : "Timer"}`}
              >
                <ArrowLeftRight className="w-3.5 h-3.5 text-blue-500" />
                <span className="capitalize">{mode === "timer" ? "Stopwatch" : "Timer"}</span>
              </button>

              <button
                onClick={onClose}
                className="p-1.5 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Alarm Ringing Banner */}
          {isAlarmRinging && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="bg-rose-500 text-white px-4 py-2.5 flex items-center justify-between animate-pulse"
            >
              <div className="flex items-center gap-2 text-xs font-bold">
                <Bell className="w-4 h-4 animate-bounce" />
                <span>Time's up! Session completed.</span>
              </div>
              <button
                onClick={stopAlarm}
                className="px-2.5 py-1 text-[11px] font-black uppercase tracking-wider bg-white text-rose-600 hover:bg-rose-50 rounded-lg shadow cursor-pointer"
              >
                Dismiss Alarm
              </button>
            </motion.div>
          )}

          {/* Main Body */}
          <div className="p-6 flex flex-col items-center justify-center">
            {/* CIRCULAR TIMER DISPLAY */}
            <div className="relative w-56 h-56 flex items-center justify-center my-2">
              <svg className="w-full h-full transform -rotate-90" viewBox="0 0 200 200">
                {/* Background Track */}
                <circle
                  cx="100"
                  cy="100"
                  r={radius}
                  className="stroke-slate-100 dark:stroke-slate-800/80 fill-none"
                  strokeWidth="10"
                />
                {/* Animated Progress Circle */}
                <circle
                  cx="100"
                  cy="100"
                  r={radius}
                  className={`fill-none transition-all duration-300 ease-out ${
                    mode === "timer"
                      ? isAlarmRinging
                        ? "stroke-rose-500"
                        : "stroke-blue-500 dark:stroke-blue-400"
                      : "stroke-emerald-500 dark:stroke-emerald-400"
                  }`}
                  strokeWidth="10"
                  strokeDasharray={circumference}
                  strokeDashoffset={mode === "timer" ? timerStrokeDashoffset : swStrokeDashoffset}
                  strokeLinecap="round"
                />
              </svg>

              {/* Center Content */}
              <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-4">
                {mode === "timer" ? (
                  <>
                    <span className="text-3xl sm:text-4xl font-black font-mono text-slate-800 dark:text-slate-100 tracking-tight">
                      {formatTimerDisplay(timerSecondsLeft)}
                    </span>
                    <span className="mt-1 text-[11px] font-bold tracking-wider text-slate-600 dark:text-slate-400 uppercase">
                      {isTimerRunning ? "Counting Down" : timerSecondsLeft === 0 ? "Finished" : "Paused"}
                    </span>
                  </>
                ) : (
                  <>
                    <div className="flex items-baseline justify-center font-mono">
                      <span className="text-3xl sm:text-4xl font-black text-slate-800 dark:text-slate-100 tracking-tight">
                        {formatStopwatchDisplay(stopwatchMs).main}
                      </span>
                      <span className="text-sm font-semibold text-emerald-600 dark:text-emerald-400 ml-1">
                        .{formatStopwatchDisplay(stopwatchMs).ms}
                      </span>
                    </div>
                    <span className="mt-1 text-[11px] font-bold tracking-wider text-slate-600 dark:text-slate-400 uppercase">
                      {isStopwatchRunning ? "Measuring Time" : "Stopwatch"}
                    </span>
                  </>
                )}
              </div>
            </div>

            {/* CONTROLS */}
            {mode === "timer" ? (
              <div className="w-full flex flex-col items-center gap-4 mt-2">
                {/* Quick Presets */}
                <div className="flex items-center justify-center gap-1.5 flex-wrap">
                  {[5, 10, 15, 25, 45, 60].map((mins) => {
                    const isActive = timerInitialSeconds === mins * 60;
                    return (
                      <button
                        key={mins}
                        onClick={() => handleSetPreset(mins)}
                        className={`px-2.5 py-1 text-xs font-bold rounded-xl transition-all cursor-pointer border ${
                          isActive
                            ? "bg-blue-600 text-white border-blue-600 shadow-md shadow-blue-500/20"
                            : "bg-slate-100 dark:bg-slate-800/80 text-slate-700 dark:text-slate-300 border-slate-200/60 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700"
                        }`}
                      >
                        {mins}m
                      </button>
                    );
                  })}
                </div>

                {/* Custom Minutes Adjuster */}
                <div className="flex items-center gap-2 bg-slate-50 dark:bg-slate-900/60 px-3 py-1.5 rounded-2xl border border-slate-200/60 dark:border-slate-800">
                  <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">Custom:</span>
                  <button
                    onClick={() => handleApplyCustomMinutes(customMinutes - 5)}
                    className="p-1 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300"
                  >
                    <Minus className="w-3.5 h-3.5" />
                  </button>
                  <input
                    type="number"
                    min="1"
                    max="300"
                    value={customMinutes}
                    onChange={(e) => handleApplyCustomMinutes(parseInt(e.target.value) || 1)}
                    className="w-12 text-center text-xs font-extrabold bg-transparent text-slate-800 dark:text-slate-100 focus:outline-none"
                  />
                  <span className="text-xs font-medium text-slate-400">mins</span>
                  <button
                    onClick={() => handleApplyCustomMinutes(customMinutes + 5)}
                    className="p-1 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Start / Pause / Reset Action Buttons */}
                <div className="flex items-center gap-3 mt-1">
                  {!isTimerRunning ? (
                    <button
                      onClick={handleStartTimer}
                      className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl font-bold text-sm shadow-lg shadow-blue-500/25 transition-all cursor-pointer active:scale-95"
                    >
                      <Play className="w-4 h-4 fill-white" />
                      <span>Start</span>
                    </button>
                  ) : (
                    <button
                      onClick={handlePauseTimer}
                      className="flex items-center gap-2 px-6 py-2.5 bg-amber-500 hover:bg-amber-600 text-white rounded-2xl font-bold text-sm shadow-lg shadow-amber-500/25 transition-all cursor-pointer active:scale-95"
                    >
                      <Pause className="w-4 h-4 fill-white" />
                      <span>Pause</span>
                    </button>
                  )}

                  <button
                    onClick={handleResetTimer}
                    className="p-2.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-2xl transition-all cursor-pointer border border-slate-200/60 dark:border-slate-700"
                    title="Reset Timer"
                  >
                    <RotateCcw className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ) : (
              <div className="w-full flex flex-col items-center gap-4 mt-2">
                {/* Stopwatch Action Buttons */}
                <div className="flex items-center gap-3">
                  {!isStopwatchRunning ? (
                    <button
                      onClick={handleStartStopwatch}
                      className="flex items-center gap-2 px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl font-bold text-sm shadow-lg shadow-emerald-500/25 transition-all cursor-pointer active:scale-95"
                    >
                      <Play className="w-4 h-4 fill-white" />
                      <span>Start</span>
                    </button>
                  ) : (
                    <button
                      onClick={handlePauseStopwatch}
                      className="flex items-center gap-2 px-6 py-2.5 bg-amber-500 hover:bg-amber-600 text-white rounded-2xl font-bold text-sm shadow-lg shadow-amber-500/25 transition-all cursor-pointer active:scale-95"
                    >
                      <Pause className="w-4 h-4 fill-white" />
                      <span>Pause</span>
                    </button>
                  )}

                  {isStopwatchRunning && (
                    <button
                      onClick={handleAddLap}
                      className="flex items-center gap-1.5 px-4 py-2.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-2xl font-bold text-sm transition-all cursor-pointer border border-slate-200/60 dark:border-slate-700"
                    >
                      <Flag className="w-4 h-4 text-emerald-500" />
                      <span>Lap</span>
                    </button>
                  )}

                  <button
                    onClick={handleResetStopwatch}
                    className="p-2.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-2xl transition-all cursor-pointer border border-slate-200/60 dark:border-slate-700"
                    title="Reset Stopwatch"
                  >
                    <RotateCcw className="w-4 h-4" />
                  </button>
                </div>

                {/* Laps List */}
                {laps.length > 0 && (
                  <div className="w-full max-h-32 overflow-y-auto mt-2 space-y-1.5 pr-1 text-xs">
                    <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 block mb-1">
                      Recorded Laps
                    </span>
                    {laps.map((lapMs, index) => {
                      const lapNo = laps.length - index;
                      const formatted = formatStopwatchDisplay(lapMs);
                      return (
                        <div
                          key={index}
                          className="flex items-center justify-between px-3 py-1.5 bg-slate-50 dark:bg-slate-900/60 rounded-xl border border-slate-100 dark:border-slate-800 font-mono"
                        >
                          <span className="font-bold text-slate-500">Lap {lapNo}</span>
                          <span className="font-bold text-slate-800 dark:text-slate-200">
                            {formatted.main}.<span className="text-emerald-500">{formatted.ms}</span>
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
