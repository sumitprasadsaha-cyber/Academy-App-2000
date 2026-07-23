import React, { useState, useEffect } from "react";
import { 
  GraduationCap, 
  ShieldAlert, 
  ArrowRight, 
  UserCheck, 
  Lock, 
  Loader2, 
  Mail, 
  Building2, 
  User, 
  KeyRound,
  Eye,
  EyeOff
} from "lucide-react";
import { createNewUserAuth, getFirebaseAuth, getFirebaseDb } from "../lib/firebase";
import { 
  signInWithEmailAndPassword, 
  updatePassword
} from "firebase/auth";
import { doc, updateDoc } from "firebase/firestore";
import { 
  getUserDocument, 
  saveUserDocument, 
  getInstitutionName,
  getAllAdmins
} from "../lib/firestoreService";

interface LoginProps {
  onLoginSuccess: (role: "Admin" | "Student", studentId: string | null, userId: string) => void;
  onInstitutionNameLoaded?: (name: string) => void;
}

export default function Login({ onLoginSuccess, onInstitutionNameLoaded }: LoginProps) {
  const [mode, setMode] = useState<"Login" | "ForceChangePassword">("Login");
  
  // Login form fields
  const [emailVal, setEmailVal] = useState("");
  const [passwordVal, setPasswordVal] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  // Force Change Password fields
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [forceChangeUser, setForceChangeUser] = useState<any>(null);
  const [forceChangeUserDoc, setForceChangeUserDoc] = useState<any>(null);

  // Status indicators
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isInitializing, setIsInitializing] = useState(true);
  const [currentInstName, setCurrentInstName] = useState("Ingenious Study Circle");

  useEffect(() => {
    const ensureDefaultAdmin = async () => {
      try {
        const admins = await getAllAdmins();
        const exists = admins.some((admin) => admin.email?.toLowerCase() === "sumitprasadsaha@gmail.com");
        if (!exists) {
          const uid = await createNewUserAuth("sumitprasadsaha@gmail.com", "utyac48@jjE");
          await saveUserDocument(uid, {
            uid,
            name: "Sumit",
            email: "sumitprasadsaha@gmail.com",
            role: "Admin",
            active: true,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            lastLogin: null
          });
        }
      } catch (err) {
        console.warn("Failed preparing default admin account:", err);
      }
    };

    void ensureDefaultAdmin();
  }, []);

  // Load Academy Name on mount
  useEffect(() => {
    let active = true;
    async function loadConfig() {
      try {
        const inst = await getInstitutionName();
        if (!active) return;
        setCurrentInstName(inst);
        if (onInstitutionNameLoaded) {
          onInstitutionNameLoaded(inst);
        }
      } catch (err) {
        console.error("Initialization check failed:", err);
      } finally {
        if (active) {
          setIsInitializing(false);
        }
      }
    }
    loadConfig();

    const handleInstitutionNameUpdate = () => {
      getInstitutionName().then((inst) => {
        if (active) setCurrentInstName(inst);
      });
    };

    window.addEventListener("institution-name-updated", handleInstitutionNameUpdate);
    return () => {
      active = false;
      window.removeEventListener("institution-name-updated", handleInstitutionNameUpdate);
    };
  }, [onInstitutionNameLoaded]);

  // Handle Login submission
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");

    const emailInput = emailVal.trim().toLowerCase();

    if (!emailInput || !passwordVal) {
      setError("Please enter email and password.");
      return;
    }

    setLoading(true);

    try {
      const auth = await getFirebaseAuth();
      if (!auth) {
        throw new Error("Authentication system is offline.");
      }

      // 2. Authenticate using Firebase Email & Password
      let userCredential;
      try {
        userCredential = await signInWithEmailAndPassword(auth, emailInput, passwordVal);
      } catch (authErr: any) {
        // Auto-recovery for default admin account
        if (
          emailInput === "sumitprasadsaha@gmail.com" &&
          passwordVal === "utyac48@jjE"
        ) {
          try {
            const uid = await createNewUserAuth("sumitprasadsaha@gmail.com", "utyac48@jjE");
            await saveUserDocument(uid, {
              uid,
              name: "Sumit",
              email: "sumitprasadsaha@gmail.com",
              role: "Admin",
              active: true,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              lastLogin: null
            });
            userCredential = await signInWithEmailAndPassword(auth, emailInput, passwordVal);
          } catch {
            throw authErr;
          }
        } else {
          throw authErr;
        }
      }

      const user = userCredential.user;

      // 3. Fetch the user document from Firestore using the Authentication UID
      let userDoc = await getUserDocument(user.uid);

      if (!userDoc) {
        setError("This account is not registered.");
        await auth.signOut();
        setLoading(false);
        return;
      }

      // 5. Active state verification
      if (userDoc.active === false) {
        setError("Your account has been disabled. Please contact the administrator.");
        await auth.signOut();
        setLoading(false);
        return;
      }

      // 6. Force student first login temporary password change
      if (userDoc.role === "Student" && userDoc.temporaryPasswordRequired) {
        setForceChangeUser(user);
        setForceChangeUserDoc(userDoc);
        setMode("ForceChangePassword");
        setLoading(false);
        return;
      }

      // 7. Successful login: update lastLogin and route to dashboard
      const db = await getFirebaseDb();
      if (db) {
        const userDocRef = doc(db, "users", user.uid);
        await updateDoc(userDocRef, {
          lastLogin: new Date().toISOString()
        }).catch((e) => console.warn("Failed to update lastLogin", e));
      }

      setSuccess("Access Authorized!");
      const normalizedRole =
        String(userDoc.role || "").trim().toLowerCase() === "admin" ? "Admin" : "Student";
      onLoginSuccess(normalizedRole, userDoc.studentId || null, user.uid);
      setLoading(false);

    } catch (err: any) {
      console.error("Login Error:", err);
      let errMsg = "Login failed. Please check your credentials.";
      const code = (err?.code || "").toLowerCase();
      const msg = (err?.message || "").toLowerCase();

      if (
        code.includes("invalid-credential") ||
        code.includes("user-not-found") ||
        code.includes("wrong-password") ||
        code.includes("invalid-email") ||
        msg.includes("invalid-credential") ||
        msg.includes("user-not-found") ||
        msg.includes("wrong-password") ||
        msg.includes("invalid-email")
      ) {
        errMsg = "Invalid email or password. Please try again.";
      } else if (code.includes("too-many-requests") || msg.includes("too-many-requests")) {
        errMsg = "Too many login attempts. Access temporarily locked. Try resetting your password.";
      } else if (code.includes("user-disabled") || msg.includes("user-disabled")) {
        errMsg = "Your account has been disabled. Please contact the administrator.";
      } else if (err?.message && typeof err.message === "string" && !err.message.startsWith("Firebase:")) {
        errMsg = err.message;
      }
      setError(errMsg);
      setLoading(false);
    }
  };

  // Handle Forced Change Password on Student First Login
  const handleForceChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (!newPassword || !confirmNewPassword) {
      setError("Please enter both password fields.");
      return;
    }

    if (newPassword.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }

    if (newPassword !== confirmNewPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);

    try {
      if (!forceChangeUser || !forceChangeUserDoc) {
        throw new Error("Temporary password verification session expired. Please log in again.");
      }

      // 1. Update password in Firebase Auth
      await updatePassword(forceChangeUser, newPassword);

      // 2. Update Firestore user document
      const db = await getFirebaseDb();
      if (db) {
        const userDocRef = doc(db, "users", forceChangeUser.uid);
        await updateDoc(userDocRef, {
          temporaryPasswordRequired: false,
          updatedAt: new Date().toISOString(),
          lastLogin: new Date().toISOString()
        });
      }

      setSuccess("Password updated successfully! Welcome.");

      setTimeout(() => {
        onLoginSuccess("Student", forceChangeUserDoc.studentId || null, forceChangeUser.uid);
        setLoading(false);
      }, 1000);

    } catch (err: any) {
      console.error("Force password change error:", err);
      setError(err.message || "Failed to update temporary password. You may need to log out and re-login.");
      setLoading(false);
    }
  };

  if (isInitializing) {
    return (
      <div className="w-full max-w-md bg-white dark:bg-[#111827] border border-slate-100 dark:border-slate-800 rounded-3xl shadow-2xl p-6 sm:p-8 flex flex-col items-center justify-center gap-4 animate-fadeIn" id="login-container">
        <Loader2 className="w-10 h-10 text-blue-500 animate-spin" />
        <span className="text-sm font-semibold text-slate-500 dark:text-slate-400">
          Loading Academy Configuration...
        </span>
      </div>
    );
  }

  return (
    <div className="w-full max-w-md bg-white dark:bg-[#111827] border border-slate-100 dark:border-slate-800 rounded-3xl shadow-2xl p-6 sm:p-8 flex flex-col gap-6 animate-fadeIn" id="login-container">
      
      {/* App Logo & Brand Header */}
      <div className="flex flex-col items-center text-center gap-1.5" id="brand-header">
        <div className="p-3.5 bg-gradient-to-br from-blue-500 to-indigo-600 text-white rounded-2xl shadow-md">
          <GraduationCap className="w-8 h-8" />
        </div>
        <h1 className="text-xl sm:text-2xl font-black tracking-tight text-slate-800 dark:text-slate-100 uppercase mt-2">
          {currentInstName}
        </h1>
      </div>

      {/* LOGIN MODE */}
      {mode === "Login" && (
        <form onSubmit={handleLogin} className="flex flex-col gap-4 animate-fadeIn" id="login-form">
          {/* Field: Email */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
              <Mail className="w-3.5 h-3.5 text-blue-500" />
              Registered Email Address
            </label>
            <input
              type="email"
              placeholder=""
              value={emailVal}
              onChange={(e) => {
                setEmailVal(e.target.value);
                setError("");
              }}
              className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-800 dark:text-slate-100 placeholder-slate-400 text-sm font-semibold transition-all focus:outline-hidden focus:ring-2 focus:ring-blue-500/10 h-[46px]"
              required
              disabled={loading}
            />
          </div>

          {/* Field: Password */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
              <Lock className="w-3.5 h-3.5 text-blue-500" />
              Password
            </label>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                placeholder=""
                value={passwordVal}
                onChange={(e) => {
                  setPasswordVal(e.target.value);
                  setError("");
                }}
                className="w-full pl-4 pr-10 py-2.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-800 dark:text-slate-100 placeholder-slate-400 text-sm font-semibold transition-all focus:outline-hidden focus:ring-2 focus:ring-blue-500/10 h-[46px]"
                required
                disabled={loading}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {error && (
            <span className="text-[11px] text-rose-500 font-extrabold flex items-start gap-1.5 animate-fadeIn leading-relaxed">
              <ShieldAlert className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>{error}</span>
            </span>
          )}

          {success && (
            <span className="text-[11px] text-emerald-500 font-extrabold flex items-center gap-1.5 animate-fadeIn leading-relaxed">
              <UserCheck className="w-3.5 h-3.5 shrink-0" />
              {success}
            </span>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3.5 px-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-extrabold rounded-xl flex items-center justify-center gap-2 shadow-md shadow-blue-500/10 transition-all cursor-pointer text-xs uppercase tracking-wider h-[46px]"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Authorizing Portal...</span>
              </>
            ) : (
              <>
                <span>Login</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </form>
      )}

      {/* FORCE CHANGE PASSWORD MODE (Student First Login) */}
      {mode === "ForceChangePassword" && (
        <form onSubmit={handleForceChangePassword} className="flex flex-col gap-4 animate-fadeIn" id="force-change-password-form">
          <div className="text-center">
            <h2 className="text-lg font-black tracking-tight text-slate-800 dark:text-slate-100 uppercase">
              First Login Security Check
            </h2>
            <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5 leading-relaxed">
              You are logging in with a temporary password. Please set a secure password before entering the student portal.
            </p>
          </div>

          {/* Field: New Password */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
              <Lock className="w-3.5 h-3.5 text-blue-500" />
              New Security Password
            </label>
            <input
              type="password"
              placeholder="At least 6 characters"
              value={newPassword}
              onChange={(e) => {
                setNewPassword(e.target.value);
                setError("");
              }}
              className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-800 dark:text-slate-100 placeholder-slate-400 text-sm font-semibold transition-all focus:outline-hidden focus:ring-2 focus:ring-blue-500/10 h-[46px]"
              required
              disabled={loading}
            />
          </div>

          {/* Field: Confirm New Password */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
              <KeyRound className="w-3.5 h-3.5 text-blue-500" />
              Confirm New Password
            </label>
            <input
              type="password"
              placeholder="Retype new password"
              value={confirmNewPassword}
              onChange={(e) => {
                setConfirmNewPassword(e.target.value);
                setError("");
              }}
              className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-800 dark:text-slate-100 placeholder-slate-400 text-sm font-semibold transition-all focus:outline-hidden focus:ring-2 focus:ring-blue-500/10 h-[46px]"
              required
              disabled={loading}
            />
          </div>

          {error && (
            <span className="text-[11px] text-rose-500 font-extrabold flex items-center gap-1.5 animate-fadeIn leading-relaxed">
              <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
              {error}
            </span>
          )}

          {success && (
            <span className="text-[11px] text-emerald-500 font-extrabold flex items-center gap-1.5 animate-fadeIn leading-relaxed">
              <UserCheck className="w-3.5 h-3.5 shrink-0" />
              {success}
            </span>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3.5 px-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-extrabold rounded-xl flex items-center justify-center gap-2 shadow-md shadow-blue-500/10 transition-all cursor-pointer text-xs uppercase tracking-wider h-[46px]"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Saving Password...</span>
              </>
            ) : (
              <>
                <span>Change Password & Login</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </form>
      )}


    </div>
  );
}
