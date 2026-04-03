import { useNavigate } from "react-router-dom";
import { auth, db, rtdb } from "./firebase/firebase";
import { ref, onValue, remove } from "firebase/database";
import {
  collection,
  addDoc,
  getDocs,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  doc,
  serverTimestamp,
  query,
  orderBy,
  limit,
} from "firebase/firestore";
import { useState, useEffect, useRef, useCallback, lazy, Suspense } from "react";
import {
  onAuthStateChanged,
  signOut,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
} from "firebase/auth";
import { QRCode } from "react-qr-code";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from "chart.js";
import { Bar, Line } from "react-chartjs-2";

ChartJS.register(
  CategoryScale, LinearScale, BarElement, LineElement,
  PointElement, Title, Tooltip, Legend, Filler
);

const Login = lazy(() => import("./Login"));

// ─── CONSTANTES DE SEGURIDAD ──────────────────────────────────────────────────
const INACTIVITY_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutos

// ─── HELPER: registrar acción en audit log ────────────────────────────────────
async function registrarAccion(db, userEmail, accion, detalle = "") {
  try {
    console.log("🔥 INTENTANDO GUARDAR EN AUDIT LOG"); // 👈 agrega esto
    await addDoc(collection(db, "auditLog"), {
      usuario: userEmail,
      accion,
      detalle,
      timestamp: serverTimestamp(),
    }); console.log("✅ GUARDADO CORRECTAMENTE"); // 👈 agrega esto
  } catch (e) {
    console.error("❌ ERROR REAL:", e); // 👈 importante
  }
}

// ─── HELPER: fechas ───────────────────────────────────────────────────────────
function getHoy() {
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  return hoy;
}

function getNombreDia(dateObj) {
  return ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"][dateObj.getDay()];
}

function getNombreMes(mes) {
  return ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"][mes];
}

// ─────────────────────────────────────────────────────────────────────────────

function App() {
  // ── Auth & roles ──
  const [user, setUser] = useState(null);
  const [userRole, setUserRole] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  // ── Navegación ──
  const [view, setView] = useState("venta");

  // ── Datos principales ──
  const [productos, setProductos] = useState([]);
  const [ventas, setVentas] = useState([]);
  const [usuarios, setUsuarios] = useState([]);
  const [cierres, setCierres] = useState([]);
  const [auditLog, setAuditLog] = useState([]);

  // ── Carrito ──
  const [carrito, setCarrito] = useState([]);

  // ── Búsqueda y filtros ──
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");

  // ── Formulario producto ──
  const [form, setForm] = useState({ nombre: "", precio: "", stock: "", codigo: "", categoria: "", marca: "" });
  const [editId, setEditId] = useState(null);

  // ── Loading states ──
  const [cargando, setCargando] = useState(false);
  const [loadingAction, setLoadingAction] = useState(false);
  const [usersLoading, setUsersLoading] = useState(false);
  const [newUserLoading, setNewUserLoading] = useState(false);
  const [closeLoading, setCloseLoading] = useState(false);
  const [scanLoading, setScanLoading] = useState(false);
const [metodoPago, setMetodoPago] = useState("Efectivo");
const [montoRecibido, setMontoRecibido] = useState("");

  // ── Nuevo usuario ──
  const [newUserForm, setNewUserForm] = useState({
    email: "", password: "", confirmPassword: "", adminPassword: "", role: "cajero",
  });

  // ── Escáner local (cámara en PC) ──
  const [codigoInput, setCodigoInput] = useState("");
  const [scanActive, setScanActive] = useState(false);
  const [barcodeSupported, setBarcodeSupported] = useState(false);
  const [scannerError, setScannerError] = useState("");
  const videoRef = useRef(null);
  const codeReaderRef = useRef(null);

  // ── Escáner remoto (celular) ──
  const [sessionId] = useState(() =>
    Math.random().toString(36).slice(2, 10).toUpperCase()
  );
  const [scannerConectado, setScannerConectado] = useState(false);
  const [showQR, setShowQR] = useState(false);

  // ── Recibo ──
  const [receiptData, setReceiptData] = useState(null);

  // ── Seguridad: inactividad ──
  const inactivityTimer = useRef(null);

  // ── Dashboard: tab activo ──
  const [dashTab, setDashTab] = useState("hoy"); // "hoy" | "semana" | "mes" | "top"

  // ─────────────────────────────────────────────────────────────────────────
  
  // SEGURIDAD: Cierre de sesión por inactividad
  // ─────────────────────────────────────────────────────────────────────────
  const resetInactivityTimer = useCallback(() => {
    if (inactivityTimer.current) clearTimeout(inactivityTimer.current);
    if (!user) return;
    inactivityTimer.current = setTimeout(async () => {
      await registrarAccion(db, user?.email || "desconocido", "CIERRE_INACTIVIDAD", "Sesión cerrada por inactividad");
      await signOut(auth);
      alert("Sesión cerrada por inactividad (15 minutos).");
    }, INACTIVITY_TIMEOUT_MS);
  }, [user]);

  useEffect(() => {
    if (!user) return;
    const eventos = ["mousemove", "keydown", "click", "scroll", "touchstart"];
    eventos.forEach((e) => window.addEventListener(e, resetInactivityTimer));
    resetInactivityTimer();
    return () => {
      eventos.forEach((e) => window.removeEventListener(e, resetInactivityTimer));
      if (inactivityTimer.current) clearTimeout(inactivityTimer.current);
    };
  }, [user, resetInactivityTimer]);

  // ─────────────────────────────────────────────────────────────────────────
  // AUTH
  // ─────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (!firebaseUser) {
        setUser(null);
        setUserRole(null);
        setAuthLoading(false);
        return;
      }
      setUser(firebaseUser);
      await loadUserRole(firebaseUser);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!user) return;
    cargarProductos();
    cargarVentas();
  }, [user]);

  useEffect(() => {
    if (userRole === "admin") {
      cargarUsuarios();
      cargarCierres();
      cargarAuditLog();
    }
    if (userRole === "cajero" && view !== "venta") {
      setView("venta");
    }
  }, [userRole]);

  // ─────────────────────────────────────────────────────────────────────────
  // ESCÁNER REMOTO
  // ─────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!user) return;
    const sessionRef = ref(rtdb, `scan-sessions/${sessionId}`);
    const unsub = onValue(sessionRef, (snap) => {
      if (!snap.exists()) return;
      let code = snap.val().code;
      code = code.replace(/"/g, "").trim();
      console.log("CÓDIGO RECIBIDO LIMPIO:", code);
      setScannerConectado(true);
      handleAddProductByCode(code);
      setTimeout(() => remove(sessionRef), 500);
    });
    return () => unsub();
  }, [user, sessionId]);

  useEffect(() => {
    setBarcodeSupported(
      typeof navigator !== "undefined" &&
      navigator.mediaDevices &&
      typeof navigator.mediaDevices.getUserMedia === "function"
    );
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  // CARGA DE DATOS
  // ─────────────────────────────────────────────────────────────────────────
  const loadUserRole = async (firebaseUser) => {
    setAuthLoading(true);
    try {
      const userRef = doc(db, "users", firebaseUser.uid);
      const userSnap = await getDoc(userRef);
      if (userSnap.exists()) {
        setUserRole(userSnap.data().role || "cajero");
      } else {
        const usersSnapshot = await getDocs(collection(db, "users"));
        const role = usersSnapshot.empty ? "admin" : "cajero";
        await setDoc(userRef, { email: firebaseUser.email, role, createdAt: serverTimestamp() });
        setUserRole(role);
      }
    } catch (error) {
      console.error("Error al cargar el rol de usuario:", error);
      setUserRole("cajero");
    } finally {
      setAuthLoading(false);
    }
  };

  const cargarProductos = async () => {
    setCargando(true);
    try {
      const querySnapshot = await getDocs(collection(db, "productos"));
      setProductos(querySnapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
    } catch (error) {
      console.error("Error al cargar productos:", error);
      alert("No se pudieron cargar los productos.");
    } finally {
      setCargando(false);
    }
  };

  const cargarVentas = async () => {
    try {
      const querySnapshot = await getDocs(collection(db, "ventas"));
      setVentas(querySnapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
    } catch (error) {
      console.error("Error al cargar ventas:", error);
    }
  };

  const cargarUsuarios = async () => {
    setUsersLoading(true);
    try {
      const querySnapshot = await getDocs(collection(db, "users"));
      setUsuarios(querySnapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
    } catch (error) {
      console.error("Error al cargar usuarios:", error);
    } finally {
      setUsersLoading(false);
    }
  };

  const cargarCierres = async () => {
    try {
      const querySnapshot = await getDocs(collection(db, "cierres"));
      const lista = querySnapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      lista.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
      setCierres(lista);
    } catch (error) {
      console.error("Error al cargar cierres:", error);
    }
  };

  const cargarAuditLog = async () => {
    try {
      const q = query(collection(db, "auditLog"), orderBy("timestamp", "desc"), limit(50));
      const querySnapshot = await getDocs(q);
      setAuditLog(querySnapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
    } catch (error) {
      console.error("Error al cargar audit log:", error);
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  // PRODUCTOS
  // ─────────────────────────────────────────────────────────────────────────
  const resetForm = () => {
    setEditId(null);
    setForm({ nombre: "", precio: "", stock: "", codigo: "", categoria: "", marca: "" });
  };

  const handleProductSubmit = async (event) => {
    event.preventDefault();
    if (!form.nombre.trim() || !form.precio || !form.stock || !form.codigo.trim() || !form.categoria.trim()) {
      alert("Completa nombre, precio, stock, código y categoría.");
      return;
    }
    if (Number(form.precio) <= 0 || Number(form.stock) < 0) {
      alert("Precio y stock deben ser números válidos.");
      return;
    }
    const codigoExistente = productos.find((p) => p.codigo === form.codigo.trim() && p.id !== editId);
    if (codigoExistente) {
      alert("Este código ya está asignado a otro producto.");
      return;
    }
    const nuevoProducto = {
      nombre: form.nombre.trim(),
      precio: parseFloat(form.precio),
      stock: parseInt(form.stock, 10),
      codigo: form.codigo.trim(),
      categoria: form.categoria.trim(),
      marca: form.marca.trim(),
    };
    try {
      setLoadingAction(true);
      if (editId) {
        await updateDoc(doc(db, "productos", editId), nuevoProducto);
        await registrarAccion(db, user.email, "EDITAR_PRODUCTO", `ID: ${editId} - ${nuevoProducto.nombre}`);
        alert("Producto actualizado.");
      } else {
        const docRef = await addDoc(collection(db, "productos"), nuevoProducto);
        await registrarAccion(db, user.email, "AGREGAR_PRODUCTO", `ID: ${docRef.id} - ${nuevoProducto.nombre}`);
        alert("Producto agregado.");
      }
      resetForm();
      cargarProductos();
    } catch (error) {
      console.error("Error al guardar producto:", error);
      alert("No se pudo guardar el producto.");
    } finally {
      setLoadingAction(false);
    }
  };

  const handleEditProduct = (producto) => {
    setEditId(producto.id);
    setForm({
      nombre: producto.nombre,
      precio: String(producto.precio),
      stock: String(producto.stock),
      codigo: producto.codigo || "",
      categoria: producto.categoria || "",
      marca: producto.marca || "",
    });
    setView("productos");
  };

  const handleDeleteProduct = async (id) => {
    const confirmar = window.confirm("¿Eliminar este producto permanentemente?");
    if (!confirmar) return;
    try {
      const prod = productos.find((p) => p.id === id);
      await deleteDoc(doc(db, "productos", id));
      await registrarAccion(db, user.email, "ELIMINAR_PRODUCTO", `ID: ${id} - ${prod?.nombre || ""}`);
      cargarProductos();
      alert("Producto eliminado.");
    } catch (error) {
      console.error("Error al eliminar producto:", error);
      alert("No se pudo eliminar el producto.");
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  // CARRITO
  // ─────────────────────────────────────────────────────────────────────────
  const handleAddToCart = (producto) => {
    if (producto.stock <= 0) {
      alert("No hay stock disponible.");
      return;
    }
    setCarrito((prev) => {
      const existente = prev.find((item) => item.id === producto.id);
      if (existente) {
        if (existente.cantidad >= producto.stock) {
          alert("No puedes agregar más, stock insuficiente.");
          return prev;
        }
        return prev.map((item) =>
          item.id === producto.id ? { ...item, cantidad: item.cantidad + 1 } : item
        );
      }
      return [...prev, { id: producto.id, nombre: producto.nombre, precio: producto.precio, cantidad: 1 }];
    });
  };

  const handleCartQuantity = (id, delta) => {
    setCarrito((prev) =>
      prev
        .map((item) => item.id === id ? { ...item, cantidad: Math.max(1, item.cantidad + delta) } : item)
        .filter((item) => item.cantidad > 0)
    );
  };

  const handleRemoveFromCart = (id) => {
    setCarrito((prev) => prev.filter((item) => item.id !== id));
  };

  const handleAddProductByCode = (code) => {
    const trimmed = code.trim();
    if (!trimmed) { alert("Ingresa un código válido."); return; }
const producto = productos.find((p) => String(p.codigo) === String(trimmed) || p.id === trimmed);    if (!producto) { alert(`No se encontró producto con el código ${trimmed}.`); return; }
    handleAddToCart(producto);
    setCodigoInput("");
  };

  // ─────────────────────────────────────────────────────────────────────────
  // VENTA / CHECKOUT
  // ─────────────────────────────────────────────────────────────────────────
  const handleCheckout = async () => {
    if (carrito.length === 0) { alert("Agrega productos al carrito antes de vender."); return; }
    const total = carrito.reduce((acc, item) => acc + item.precio * item.cantidad, 0);
    const items = carrito.map((item) => ({
      productoId: item.id, nombre: item.nombre, precio: item.precio, cantidad: item.cantidad,
    }));
    try {
      setLoadingAction(true);
      const ventaRef = await addDoc(collection(db, "ventas"), {
        items, total, createdAt: serverTimestamp(), cajero: user.email,metodoPago ,montoRecibido: metodoPago === "Efectivo" ? Number(montoRecibido) : null,
  vuelto: metodoPago === "Efectivo" ? Number(montoRecibido) - total : 0,
      });
      await registrarAccion(db, user.email, "VENTA", `ID: ${ventaRef.id} - Total: S/${total.toFixed(2)}`);
      setReceiptData({ id: ventaRef.id, items, total, date: new Date().toLocaleString(), pagoPor: user.email });
      const productosMap = productos.reduce((map, p) => { map[p.id] = p; return map; }, {});
      await Promise.all(
        carrito.map((item) => {
          const productoActual = productosMap[item.id];
          const nuevoStock = Math.max(0, productoActual.stock - item.cantidad);
          return updateDoc(doc(db, "productos", item.id), { stock: nuevoStock });
        })
      );
      alert("Venta registrada correctamente.");
       setCarrito([]);
       setMontoRecibido("");
       setMetodoPago("Efectivo");
       cargarProductos();
       cargarVentas();
    } catch (error) {
      console.error("Error al registrar venta:", error);
      alert("No se pudo completar la venta.");
    } finally {
      setLoadingAction(false);
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  // ESCÁNER LOCAL (CÁMARA EN PC)
  // ─────────────────────────────────────────────────────────────────────────
  const stopBarcodeScanner = () => {
    setScanActive(false);
    setScanLoading(false);
    if (codeReaderRef.current && typeof codeReaderRef.current.reset === "function") {
      codeReaderRef.current.reset();
      codeReaderRef.current = null;
    }
    if (videoRef.current?.srcObject) {
      videoRef.current.srcObject.getTracks().forEach((t) => t.stop());
      videoRef.current.srcObject = null;
    }
  };

  const scanFrame = async (detector) => {
    if (!scanActive || !videoRef.current) return;
    try {
      const detections = await detector.detect(videoRef.current);
      if (detections.length > 0) {
        const code = detections[0].rawValue;
        stopBarcodeScanner();
        setScannerError("");
        setCodigoInput(code);
        handleAddProductByCode(code);
        return;
      }
    } catch (error) {
      setScannerError("No se pudo leer el código. Asegúrate de que la cámara tenga buena luz.");
    }
    requestAnimationFrame(() => scanFrame(detector));
  };

  const startBarcodeScanner = async () => {
    if (!barcodeSupported) { setScannerError("Este navegador no admite escaneo con cámara."); return; }
    try {
      setScannerError("");
      setScanLoading(true);
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
      setScanActive(true);
      if (typeof window !== "undefined" && "BarcodeDetector" in window) {
        const detector = new window.BarcodeDetector({ formats: ["ean_13", "ean_8", "code_39", "code_128", "upc_e", "upc_a"] });
        scanFrame(detector);
      } else {
        const { BrowserMultiFormatReader } = await import("@zxing/browser");
        const codeReader = new BrowserMultiFormatReader();
        codeReaderRef.current = codeReader;
        const devices = await BrowserMultiFormatReader.listVideoInputDevices();
        codeReader.decodeFromVideoDevice(devices[0]?.deviceId, videoRef.current, (result, error) => {
          if (result) { stopBarcodeScanner(); setScannerError(""); setCodigoInput(result.getText()); handleAddProductByCode(result.getText()); }
          if (error && error.name !== "NotFoundException") setScannerError("No se pudo leer el código. Asegúrate de tener buena luz.");
        });
      }
      setScanLoading(false);
    } catch (error) {
      setScannerError("No se pudo acceder a la cámara. Comprueba permisos.");
      setScanLoading(false);
      stopBarcodeScanner();
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  // USUARIOS
  // ─────────────────────────────────────────────────────────────────────────
  const handleChangeUserRole = async (userId, currentRole) => {
    if (userId === user.uid) { alert("No puedes cambiar tu propio rol."); return; }
    try {
      setLoadingAction(true);
      const nextRole = currentRole === "admin" ? "cajero" : "admin";
      await updateDoc(doc(db, "users", userId), { role: nextRole });
      await registrarAccion(db, user.email, "CAMBIO_ROL", `Usuario ID: ${userId} → ${nextRole}`);
      cargarUsuarios();
    } catch (error) {
      alert("No se pudo actualizar el rol.");
    } finally {
      setLoadingAction(false);
    }
  };

  const handleCreateWorker = async (event) => {
    event.preventDefault();
    if (!newUserForm.email.trim() || !newUserForm.password || !newUserForm.confirmPassword || !newUserForm.adminPassword) {
      alert("Completa todos los campos."); return;
    }
    if (newUserForm.password !== newUserForm.confirmPassword) { alert("Las contraseñas no coinciden."); return; }
    if (newUserForm.password.length < 6) { alert("La contraseña debe tener al menos 6 caracteres."); return; }
    try {
      setNewUserLoading(true);
      const adminEmail = user.email;
      const credential = await createUserWithEmailAndPassword(auth, newUserForm.email.trim(), newUserForm.password);
      await setDoc(doc(db, "users", credential.user.uid), {
        email: newUserForm.email.trim(), role: newUserForm.role, createdAt: serverTimestamp(),
      });
      await registrarAccion(db, adminEmail, "CREAR_USUARIO", `Email: ${newUserForm.email.trim()} - Rol: ${newUserForm.role}`);
      await signInWithEmailAndPassword(auth, adminEmail, newUserForm.adminPassword);
      cargarUsuarios();
      alert("Trabajador creado correctamente.");
      setNewUserForm({ email: "", password: "", confirmPassword: "", adminPassword: "", role: "cajero" });
    } catch (error) {
      alert(error.message || "No se pudo crear el trabajador.");
    } finally {
      setNewUserLoading(false);
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  // CIERRE DE CAJA
  // ─────────────────────────────────────────────────────────────────────────
  const handleCloseCashRegister = async () => {
    if (!window.confirm("Cerrar caja generará un reporte de las ventas del día. Continuar?")) return;
    const today = new Date();
    const start = new Date(today); start.setHours(0, 0, 0, 0);
    const end = new Date(today); end.setHours(23, 59, 59, 999);
    const ventasHoy = ventas.filter((v) => {
      const s = v.createdAt?.seconds;
      if (!s) return false;
      const f = new Date(s * 1000);
      return f >= start && f <= end;
    });
    const totalHoy = ventasHoy.reduce((acc, v) => acc + Number(v.total || 0), 0);
    try {
      setCloseLoading(true);
      await addDoc(collection(db, "cierres"), {
        fecha: start.toISOString().slice(0, 10),
        total: totalHoy,
        ventasCount: ventasHoy.length,
        registradoPor: user.email,
        createdAt: serverTimestamp(),
      });
      await registrarAccion(db, user.email, "CIERRE_CAJA", `Fecha: ${start.toISOString().slice(0,10)} - Total: S/${totalHoy.toFixed(2)}`);
      await cargarCierres();
      alert("Cierre de caja registrado.");
    } catch (error) {
      alert("No se pudo cerrar la caja.");
    } finally {
      setCloseLoading(false);
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  // RECIBO
  // ─────────────────────────────────────────────────────────────────────────
  const handlePrintReceipt = (receipt) => {
    const itemsHtml = receipt.items
      .map((item) => `<tr><td>${item.nombre}</td><td>${item.cantidad}</td><td>S/${item.precio.toFixed(2)}</td><td>S/${(item.precio * item.cantidad).toFixed(2)}</td></tr>`)
      .join("");
    const receiptHtml = `<html><head><title>Recibo</title><style>
      body{font-family:Arial,sans-serif;padding:24px;color:#111;background:#fff}
      .shell{max-width:520px;margin:0 auto}
      .name{font-size:22px;font-weight:700;margin-bottom:6px}
      .info{color:#4b5563;font-size:13px;margin-bottom:20px}
      .title{font-size:18px;font-weight:700;margin:16px 0 6px}
      .meta{color:#6b7280;font-size:13px;margin:2px 0}
      .div{margin:18px 0;border-top:1px solid #e5e7eb}
      table{width:100%;border-collapse:collapse;margin-top:12px}
      td,th{padding:10px 8px;border-bottom:1px solid #e5e7eb;text-align:left}
      th{background:#f8fafc;font-weight:600}
      .tot td{font-weight:700}
      .note{color:#6b7280;font-size:13px;margin-top:12px}
    </style></head><body><div class="shell">
      <div class="name">MiniMarket POS</div>
      <div class="info">Av. Comercio 123 · Zona local · Tel: 0000-0000</div>
      <div class="div"></div>
      <div class="title">Recibo de venta</div>
      <p class="meta">ID: ${receipt.id}</p>
      <p class="meta">Fecha: ${receipt.date}</p>
      <p class="meta">Cajero: ${receipt.pagoPor}</p>
      <div class="div"></div>
      <table><thead><tr><th>Producto</th><th>Cant.</th><th>Precio</th><th>Subtotal</th></tr></thead>
      <tbody>${itemsHtml}<tr class="tot"><td colspan="3">Total</td><td>S/${receipt.total.toFixed(2)}</td></tr></tbody></table>
      <div class="div"></div>
      <p class="note">Gracias por su compra. ¡Vuelve pronto!</p>
    </div></body></html>`;
    const w = window.open("", "_blank", "width=600,height=800");
    if (!w) { alert("No se pudo abrir la ventana de impresión."); return; }
    w.document.write(receiptHtml);
    w.document.close();
    w.focus();
    w.print();
  };

  // ─────────────────────────────────────────────────────────────────────────
  // CÁLCULOS PARA ESTADÍSTICAS
  // ─────────────────────────────────────────────────────────────────────────
  const hoy = getHoy();

  // Ventas de hoy
  const ventasHoy = ventas.filter((v) => {
    const s = v.createdAt?.seconds;
    if (!s) return false;
    const f = new Date(s * 1000);
    return f >= hoy;
  });
  const totalHoy = ventasHoy.reduce((acc, v) => acc + Number(v.total || 0), 0);

  // Gráfica semanal: últimos 7 días
  const semanaLabels = [];
  const semanaData = [];
  for (let i = 6; i >= 0; i--) {
    const dia = new Date(hoy);
    dia.setDate(dia.getDate() - i);
    const diaFin = new Date(dia);
    diaFin.setHours(23, 59, 59, 999);
    semanaLabels.push(getNombreDia(dia));
    const total = ventas
      .filter((v) => {
        const s = v.createdAt?.seconds;
        if (!s) return false;
        const f = new Date(s * 1000);
        return f >= dia && f <= diaFin;
      })
      .reduce((acc, v) => acc + Number(v.total || 0), 0);
    semanaData.push(parseFloat(total.toFixed(2)));
  }

  // Gráfica mensual: últimos 6 meses
  const mesLabels = [];
  const mesData = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - i);
    d.setHours(0, 0, 0, 0);
    const dFin = new Date(d);
    dFin.setMonth(dFin.getMonth() + 1);
    dFin.setDate(0);
    dFin.setHours(23, 59, 59, 999);
    mesLabels.push(getNombreMes(d.getMonth()));
    const total = ventas
      .filter((v) => {
        const s = v.createdAt?.seconds;
        if (!s) return false;
        const f = new Date(s * 1000);
        return f >= d && f <= dFin;
      })
      .reduce((acc, v) => acc + Number(v.total || 0), 0);
    mesData.push(parseFloat(total.toFixed(2)));
  }

  // Top productos
  const topProductos = (() => {
    const contador = {};
    ventas.forEach((v) => {
      (v.items || []).forEach((item) => {
        if (!contador[item.nombre]) contador[item.nombre] = { cantidad: 0, total: 0 };
        contador[item.nombre].cantidad += item.cantidad;
        contador[item.nombre].total += item.precio * item.cantidad;
      });
    });
    return Object.entries(contador)
      .map(([nombre, data]) => ({ nombre, ...data }))
      .sort((a, b) => b.cantidad - a.cantidad)
      .slice(0, 8);
  })();

  // ── Datos generales para reportes ──
  const totalVentas = ventas.reduce((acc, v) => acc + Number(v.total || 0), 0);
  const productosVendidos = ventas.reduce((acc, v) => acc + (v.items || []).reduce((s, i) => s + i.cantidad, 0), 0);
  const stockTotal = productos.reduce((acc, p) => acc + Number(p.stock || 0), 0);
  const productosBajoStock = productos.filter((p) => p.stock <= 3).length;
  const categoriasCount = productos.reduce((acc, p) => {
    const cat = p.categoria || "Sin categoría";
    acc[cat] = (acc[cat] || 0) + 1;
    return acc;
  }, {});
  const totalVenta = carrito.reduce((acc, item) => acc + item.precio * item.cantidad, 0);

  // ── Filtros de productos ──
  const categoriasDisponibles = Array.from(new Set(productos.map((p) => p.categoria).filter(Boolean)));
  const productosFiltrados = productos.filter((p) => {
    const texto = `${p.nombre} ${p.categoria || ""} ${p.marca || ""} ${p.codigo || ""}`.toLowerCase();
    const enBusqueda = texto.includes(search.toLowerCase());
    const enCategoria = categoryFilter === "all" || (p.categoria || "").toLowerCase() === categoryFilter.toLowerCase();
    return enBusqueda && enCategoria;
  });

  // ─────────────────────────────────────────────────────────────────────────
  // GUARDS DE CARGA
  // ─────────────────────────────────────────────────────────────────────────
  if (authLoading) return <div className="page-shell">Cargando datos...</div>;
  if (!user) return (
    <Suspense fallback={<div className="page-shell">Cargando login...</div>}>
      <Login />
    </Suspense>
  );
  if (userRole === null) return <div className="page-shell">Cargando datos de usuario...</div>;

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="page-shell">

      {/* ── TOPBAR ── */}
      <header className="topbar">
        <div>
          <h1>POS Minimarket</h1>
          <p className="subtitle">
            {user.email} · <span className="role-badge">{userRole}</span>
            {scannerConectado && (
              <span className="role-badge" style={{ marginLeft: 8, background: "#d1fae5", color: "#065f46" }}>
                ● escáner activo
              </span>
            )}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button className="button secondary" onClick={() => setShowQR(true)}>
            📱 Escáner QR
          </button>
          <button className="button secondary" onClick={handleLogout}>
            Cerrar sesión
          </button>
        </div>
      </header>

      {/* ── NAV ── */}
      <nav className="nav-tabs">
        <button className={view === "venta" ? "nav-button active" : "nav-button"} onClick={() => setView("venta")}>Venta</button>
        {userRole === "admin" && <button className={view === "estadisticas" ? "nav-button active" : "nav-button"} onClick={() => setView("estadisticas")}>Estadísticas</button>}
        {userRole === "admin" && <button className={view === "productos" ? "nav-button active" : "nav-button"} onClick={() => setView("productos")}>Productos</button>}
        {userRole === "admin" && <button className={view === "usuarios" ? "nav-button active" : "nav-button"} onClick={() => setView("usuarios")}>Usuarios</button>}
        {userRole === "admin" && <button className={view === "reportes" ? "nav-button active" : "nav-button"} onClick={() => setView("reportes")}>Reportes</button>}
        {userRole === "admin" && <button className={view === "auditoria" ? "nav-button active" : "nav-button"} onClick={() => { setView("auditoria"); cargarAuditLog(); }}>Auditoría</button>}
      </nav>

      {/* ════════════════════════════════════════════════════════════════════
          VISTA: VENTA
      ════════════════════════════════════════════════════════════════════ */}
      {view === "venta" && (
        <section>
          <div className="section-header">
            <div>
              <h2>Venta rápida</h2>
              <p className="section-copy">Busca productos, agrega al carrito y cierra la venta rápido.</p>
            </div>
          </div>
          <div className="grid-2">
            {/* Productos */}
            <div className="card">
              <div className="card-header">
                <h3>Productos</h3>
                <input className="input" placeholder="Buscar producto..." value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <div className="barcode-section">
                <div className="barcode-row">
                  <input
                    className="input"
                    placeholder="Código de barras"
                    value={codigoInput}
                    onChange={(e) => setCodigoInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleAddProductByCode(codigoInput)}
                  />
                  <button className="button small secondary" type="button" onClick={() => handleAddProductByCode(codigoInput)}>
                    Agregar código
                  </button>
                  <button className="button small secondary" type="button" onClick={startBarcodeScanner} disabled={scanActive || scanLoading}>
                    {scanActive ? "Escaneando..." : "Usar cámara"}
                  </button>
                  {scanActive && (
                    <button className="button small secondary" type="button" onClick={stopBarcodeScanner}>Cancelar</button>
                  )}
                </div>
                {!barcodeSupported && <p className="note">Tu navegador no admite el lector de cámara.</p>}
                {scannerError && <p className="error-text">{scannerError}</p>}
                {scanActive && (
                  <div className="scanner-preview">
                    <video ref={videoRef} className="scanner-video" playsInline muted />
                  </div>
                )}
              </div>
              {cargando ? <p>Cargando productos...</p> : (
                <div className="list-panel">
                  {productosFiltrados.length === 0
                    ? <p className="note">No hay productos disponibles.</p>
                    : productosFiltrados.map((producto) => (
                      <div key={producto.id} className="list-item">
                        <div>
                          <strong>{producto.nombre}</strong>
                          <p className="item-meta">S/{producto.precio} • stock {producto.stock} • {producto.categoria || "Sin categoría"} • {producto.marca || "Sin marca"} • {producto.codigo || "N/A"}</p>
                        </div>
                        <button className="button primary" disabled={producto.stock <= 0} onClick={() => handleAddToCart(producto)}>
                          Añadir
                        </button>
                      </div>
                    ))
                  }
                </div>
              )}
            </div>

            {/* Carrito */}
            <div className="card">
              <div className="card-header"><h3>Carrito</h3></div>
              {carrito.length === 0 ? <p className="note">El carrito está vacío.</p> : (
                <div className="cart-list">
                  {carrito.map((item) => (
                    <div key={item.id} className="cart-item">
                      <div>
                        <strong>{item.nombre}</strong>
                        <p className="item-meta">{item.cantidad} x S/{item.precio} = S/{(item.cantidad * item.precio).toFixed(2)}</p>
                      </div>
                      <div className="cart-actions">
                        <button className="button small" onClick={() => handleCartQuantity(item.id, -1)}>-</button>
                        <button className="button small" onClick={() => handleCartQuantity(item.id, 1)}>+</button>
                        <button className="button small secondary" onClick={() => handleRemoveFromCart(item.id)}>x</button>
                      </div>
                    </div>
                  ))}
                  <div className="cart-total">Total: S/{totalVenta.toFixed(2)}</div>

{/* ── Método de pago ── */}
<div style={{ display: "flex", gap: 8, margin: "12px 0 4px" }}>
  {["Efectivo", "Yape", "Plin", "Tarjeta"].map((metodo) => (
    <button
      key={metodo}
      type="button"
      onClick={() => setMetodoPago(metodo)}
      style={{
        flex: 1,
        padding: "8px 4px",
        borderRadius: 8,
        border: metodoPago === metodo ? "2px solid #2563eb" : "1px solid #d1d5db",
        background: metodoPago === metodo ? "#eff6ff" : "#fff",
        color: metodoPago === metodo ? "#1d4ed8" : "#374151",
        fontWeight: metodoPago === metodo ? 700 : 400,
        fontSize: 12,
        cursor: "pointer",
      }}
    >
      {metodo}
    </button>
  ))}
</div>

{/* ── Monto recibido y vuelto (solo efectivo) ── */}
{metodoPago === "Efectivo" && (
  <div style={{ display: "flex", flexDirection: "column", gap: 6, margin: "8px 0" }}>
    <label style={{ fontSize: 12, color: "#6b7280" }}>Monto recibido (S/)</label>
    <input
      className="input"
      type="number"
      min={totalVenta}
      step="0.50"
      placeholder={`Mínimo S/${totalVenta.toFixed(2)}`}
      value={montoRecibido}
      onChange={(e) => setMontoRecibido(e.target.value)}
    />
    {montoRecibido && Number(montoRecibido) >= totalVenta && (
      <div style={{
        background: "#f0fdf4", border: "1px solid #86efac",
        borderRadius: 8, padding: "10px 14px",
        display: "flex", justifyContent: "space-between", alignItems: "center"
      }}>
        <span style={{ fontSize: 13, color: "#166534" }}>Vuelto</span>
        <strong style={{ fontSize: 20, color: "#16a34a" }}>
          S/{(Number(montoRecibido) - totalVenta).toFixed(2)}
        </strong>
      </div>
    )}
    {montoRecibido && Number(montoRecibido) < totalVenta && (
      <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 8, padding: "8px 14px" }}>
        <span style={{ fontSize: 12, color: "#dc2626" }}>
          Falta S/{(totalVenta - Number(montoRecibido)).toFixed(2)}
        </span>
      </div>
    )}
  </div>
)}

<button
  className="button primary"
  disabled={
    loadingAction ||
    (metodoPago === "Efectivo" && (!montoRecibido || Number(montoRecibido) < totalVenta))
  }
  onClick={handleCheckout}
>
  {loadingAction ? "Procesando venta..." : `Finalizar venta · ${metodoPago}`}
</button>
                </div>
              )}
            </div>
          </div>

          {/* Recibo */}
          {receiptData && (
            <div className="card receipt-card">
              <h3>Recibo listo</h3>
              <p className="item-meta">ID de venta: {receiptData.id}</p>
              <p className="item-meta">Fecha: {receiptData.date}</p>
              <p className="item-meta">Registrado por: {receiptData.pagoPor}</p>
              <div className="receipt-items">
                {receiptData.items.map((item) => (
                  <div key={item.productoId} className="receipt-line">
                    <span>{item.nombre} x{item.cantidad}</span>
                    <span>S/{(item.precio * item.cantidad).toFixed(2)}</span>
                  </div>
                ))}
              </div>
              <div className="cart-total">Total: S/{receiptData.total.toFixed(2)}</div>
              <button className="button primary" type="button" onClick={() => handlePrintReceipt(receiptData)}>
                Imprimir recibo
              </button>
            </div>
          )}
        </section>
      )}

      {/* ════════════════════════════════════════════════════════════════════
          VISTA: ESTADÍSTICAS (DASHBOARD PRO)
      ════════════════════════════════════════════════════════════════════ */}
      {view === "estadisticas" && userRole === "admin" && (
        <section>
          <div className="section-header">
            <div>
              <h2>Estadísticas</h2>
              <p className="section-copy">Análisis detallado de ventas por día, semana, mes y productos.</p>
            </div>
          </div>

          {/* KPIs rápidos */}
          <div className="grid-4" style={{ marginBottom: 24 }}>
            <div className="card report-card">
              <p className="report-label">Ventas hoy</p>
              <p className="report-value">S/{totalHoy.toFixed(2)}</p>
              <p className="item-meta">{ventasHoy.length} transacciones</p>
            </div>
            <div className="card report-card">
              <p className="report-label">Esta semana</p>
              <p className="report-value">S/{semanaData.reduce((a, b) => a + b, 0).toFixed(2)}</p>
            </div>
            <div className="card report-card">
              <p className="report-label">Total histórico</p>
              <p className="report-value">S/{totalVentas.toFixed(2)}</p>
            </div>
            <div className="card report-card" style={{ borderLeft: productosBajoStock > 0 ? "3px solid #ef4444" : undefined }}>
              <p className="report-label">Bajo stock</p>
              <p className="report-value" style={{ color: productosBajoStock > 0 ? "#ef4444" : undefined }}>
                {productosBajoStock} productos
              </p>
            </div>
          </div>

          {/* Tabs */}
          <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
            {[
              { key: "hoy", label: "📋 Ventas del día" },
              { key: "semana", label: "📊 Semana" },
              { key: "mes", label: "📈 Mes" },
              { key: "top", label: "🏆 Top productos" },
            ].map((tab) => (
              <button
                key={tab.key}
                className={dashTab === tab.key ? "nav-button active" : "nav-button"}
                onClick={() => setDashTab(tab.key)}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Tab: Ventas del día */}
          {dashTab === "hoy" && (
            <div className="card">
              <h3>Ventas del día — {hoy.toLocaleDateString("es-PE", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</h3>
              {ventasHoy.length === 0 ? (
                <p className="note">No hay ventas registradas hoy.</p>
              ) : (
                <>
                  <div style={{ marginBottom: 12, padding: "10px 14px", background: "#f0fdf4", borderRadius: 8, display: "flex", gap: 24 }}>
                    <span><strong>{ventasHoy.length}</strong> ventas</span>
                    <span>Total: <strong>S/{totalHoy.toFixed(2)}</strong></span>
                    <span>Promedio: <strong>S/{(totalHoy / ventasHoy.length).toFixed(2)}</strong></span>
                  </div>
                  <div className="list-panel">
                    {[...ventasHoy].reverse().map((venta) => (
                      <div key={venta.id} className="sale-item">
                        <div className="sale-summary">
  <strong>S/{Number(venta.total).toFixed(2)}</strong>
  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
    <span style={{ fontSize: 12, color: "#6b7280" }}>
      {venta.createdAt?.seconds
        ? new Date(venta.createdAt.seconds * 1000).toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit" })
        : "Sin hora"}
      {venta.cajero ? ` · ${venta.cajero}` : ""}
    </span>
    {venta.metodoPago && (
      <span style={{
        fontSize: 11, padding: "2px 8px", borderRadius: 6, fontWeight: 600,
        background:
          venta.metodoPago === "Yape" ? "#ede9fe" :
          venta.metodoPago === "Plin" ? "#dbeafe" :
          venta.metodoPago === "Tarjeta" ? "#fef9c3" : "#f0fdf4",
        color:
          venta.metodoPago === "Yape" ? "#7c3aed" :
          venta.metodoPago === "Plin" ? "#1d4ed8" :
          venta.metodoPago === "Tarjeta" ? "#92400e" : "#166534",
      }}>
        {venta.metodoPago}
        {venta.vuelto > 0 ? ` · vuelto S/${Number(venta.vuelto).toFixed(2)}` : ""}
      </span>
    )}
  </div>
</div>
                        <p className="item-meta">
                          {(venta.items || []).map((i) => `${i.nombre} x${i.cantidad}`).join(", ")}
                        </p>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Tab: Gráfica semanal */}
          {dashTab === "semana" && (
            <div className="card">
              <h3>Ventas de los últimos 7 días</h3>
              <div style={{ height: 320, marginTop: 16 }}>
                <Bar
                  data={{
                    labels: semanaLabels,
                    datasets: [{
                      label: "S/ vendido",
                      data: semanaData,
                      backgroundColor: semanaLabels.map((_, i) =>
                        i === 6 ? "rgba(59,130,246,0.85)" : "rgba(59,130,246,0.35)"
                      ),
                      borderColor: "rgba(59,130,246,1)",
                      borderWidth: 1,
                      borderRadius: 6,
                    }],
                  }}
                  options={{
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                      legend: { display: false },
                      tooltip: {
                        callbacks: { label: (ctx) => ` S/${ctx.raw.toFixed(2)}` },
                      },
                    },
                    scales: {
                      y: {
                        beginAtZero: true,
                        ticks: { callback: (v) => `S/${v}` },
                      },
                    },
                  }}
                />
              </div>
              <div style={{ marginTop: 16, display: "flex", gap: 16, flexWrap: "wrap" }}>
                {semanaLabels.map((dia, i) => (
                  <div key={dia} style={{ textAlign: "center", minWidth: 60 }}>
                    <p style={{ fontWeight: 600, fontSize: 13 }}>{dia}</p>
                    <p style={{ fontSize: 12, color: "#6b7280" }}>S/{semanaData[i].toFixed(2)}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Tab: Gráfica mensual */}
          {dashTab === "mes" && (
            <div className="card">
              <h3>Tendencia mensual (últimos 6 meses)</h3>
              <div style={{ height: 320, marginTop: 16 }}>
                <Line
                  data={{
                    labels: mesLabels,
                    datasets: [{
                      label: "S/ vendido",
                      data: mesData,
                      borderColor: "rgba(16,185,129,1)",
                      backgroundColor: "rgba(16,185,129,0.1)",
                      borderWidth: 2,
                      pointBackgroundColor: "rgba(16,185,129,1)",
                      pointRadius: 5,
                      fill: true,
                      tension: 0.4,
                    }],
                  }}
                  options={{
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                      legend: { display: false },
                      tooltip: { callbacks: { label: (ctx) => ` S/${ctx.raw.toFixed(2)}` } },
                    },
                    scales: {
                      y: {
                        beginAtZero: true,
                        ticks: { callback: (v) => `S/${v}` },
                      },
                    },
                  }}
                />
              </div>
              <div style={{ marginTop: 16, display: "flex", gap: 16, flexWrap: "wrap" }}>
                {mesLabels.map((mes, i) => (
                  <div key={mes} style={{ textAlign: "center", minWidth: 60 }}>
                    <p style={{ fontWeight: 600, fontSize: 13 }}>{mes}</p>
                    <p style={{ fontSize: 12, color: "#6b7280" }}>S/{mesData[i].toFixed(2)}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Tab: Top productos */}
          {dashTab === "top" && (
            <div className="card">
              <h3>Top 8 productos más vendidos</h3>
              {topProductos.length === 0 ? (
                <p className="note">Aún no hay ventas registradas.</p>
              ) : (
                <>
                  <div style={{ height: 320, marginTop: 16 }}>
                    <Bar
                      data={{
                        labels: topProductos.map((p) => p.nombre.length > 16 ? p.nombre.slice(0, 14) + "…" : p.nombre),
                        datasets: [{
                          label: "Unidades vendidas",
                          data: topProductos.map((p) => p.cantidad),
                          backgroundColor: "rgba(139,92,246,0.7)",
                          borderColor: "rgba(139,92,246,1)",
                          borderWidth: 1,
                          borderRadius: 6,
                        }],
                      }}
                      options={{
                        responsive: true,
                        maintainAspectRatio: false,
                        indexAxis: "y",
                        plugins: { legend: { display: false } },
                        scales: { x: { beginAtZero: true, ticks: { stepSize: 1 } } },
                      }}
                    />
                  </div>
                  <div className="list-panel" style={{ marginTop: 16 }}>
                    {topProductos.map((p, i) => (
                      <div key={p.nombre} className="list-item">
                        <div>
                          <strong>#{i + 1} {p.nombre}</strong>
                          <p className="item-meta">{p.cantidad} unidades vendidas · S/{p.total.toFixed(2)} en ventas</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </section>
      )}

      {/* ════════════════════════════════════════════════════════════════════
          VISTA: PRODUCTOS
      ════════════════════════════════════════════════════════════════════ */}
      {view === "productos" && userRole === "admin" && (
        <section>
          <div className="section-header">
            <div>
              <h2>Productos</h2>
              <p className="section-copy">Gestiona el inventario del minimarket desde aquí.</p>
            </div>
          </div>
          <div className="grid-2">
            <div className="card">
              <h3>{editId ? "Editar producto" : "Agregar producto"}</h3>
              <form onSubmit={handleProductSubmit} className="form-grid">
                <input className="input" placeholder="Nombre" value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} />
                <input className="input" type="number" placeholder="Precio" min="0" step="0.01" value={form.precio} onChange={(e) => setForm({ ...form, precio: e.target.value })} />
                <input className="input" type="number" placeholder="Stock" min="0" step="1" value={form.stock} onChange={(e) => setForm({ ...form, stock: e.target.value })} />
                <input className="input" placeholder="Categoría (ej. Lácteos)" value={form.categoria} onChange={(e) => setForm({ ...form, categoria: e.target.value })} />
                <input className="input" placeholder="Marca (ej. Gloria)" value={form.marca} onChange={(e) => setForm({ ...form, marca: e.target.value })} />
                <input className="input" placeholder="Código de barras" value={form.codigo} onChange={(e) => setForm({ ...form, codigo: e.target.value })} />
                <div className="form-actions">
                  <button className="button primary" type="submit" disabled={loadingAction}>
                    {loadingAction ? "Guardando..." : editId ? "Actualizar" : "Agregar"}
                  </button>
                  {editId && <button className="button secondary" type="button" onClick={resetForm}>Cancelar</button>}
                </div>
              </form>
            </div>
            <div className="card">
              <h3>Inventario</h3>
              <div className="filter-row">
                <input className="input" placeholder="Buscar producto..." value={search} onChange={(e) => setSearch(e.target.value)} />
                <select className="input filter-select" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
                  <option value="all">Todas las categorías</option>
                  {categoriasDisponibles.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
                </select>
              </div>
              {cargando ? <p>Cargando productos...</p> : (
                <div className="list-panel">
                  {productosFiltrados.length === 0
                    ? <p className="note">No hay productos.</p>
                    : productosFiltrados.map((producto) => (
                      <div key={producto.id} className="list-item">
                        <div>
                          <strong>{producto.nombre}</strong>
                          <p className="item-meta">
                            S/{producto.precio} • stock {producto.stock}
                            {producto.stock <= 3 && <span style={{ color: "#ef4444", marginLeft: 6 }}>⚠ bajo stock</span>}
                            {" "}• {producto.categoria || "Sin categoría"} • {producto.marca || "Sin marca"} • {producto.codigo || "N/A"}
                          </p>
                        </div>
                        <div className="list-actions">
                          <button className="button small" onClick={() => handleEditProduct(producto)}>Editar</button>
                          <button className="button small secondary" onClick={() => handleDeleteProduct(producto.id)}>Eliminar</button>
                        </div>
                      </div>
                    ))
                  }
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* ════════════════════════════════════════════════════════════════════
          VISTA: USUARIOS
      ════════════════════════════════════════════════════════════════════ */}
      {view === "usuarios" && userRole === "admin" && (
        <section>
          <div className="section-header">
            <div>
              <h2>Usuarios</h2>
              <p className="section-copy">Administra roles y permisos de los usuarios del POS.</p>
            </div>
          </div>
          <div className="grid-2">
            <div className="card">
              <h3>Crear trabajador</h3>
              <form onSubmit={handleCreateWorker} className="form-grid">
                <input className="input" type="email" placeholder="Email del trabajador" value={newUserForm.email} onChange={(e) => setNewUserForm({ ...newUserForm, email: e.target.value })} />
                <input className="input" type="password" placeholder="Contraseña" value={newUserForm.password} onChange={(e) => setNewUserForm({ ...newUserForm, password: e.target.value })} />
                <input className="input" type="password" placeholder="Confirmar contraseña" value={newUserForm.confirmPassword} onChange={(e) => setNewUserForm({ ...newUserForm, confirmPassword: e.target.value })} />
                <select className="input" value={newUserForm.role} onChange={(e) => setNewUserForm({ ...newUserForm, role: e.target.value })}>
                  <option value="cajero">Cajero</option>
                  <option value="admin">Admin</option>
                </select>
                <input className="input" type="password" placeholder="Contraseña admin actual" value={newUserForm.adminPassword} onChange={(e) => setNewUserForm({ ...newUserForm, adminPassword: e.target.value })} />
                <button className="button primary" type="submit" disabled={newUserLoading}>
                  {newUserLoading ? "Creando..." : "Crear trabajador"}
                </button>
              </form>
            </div>
            <div className="card">
              <h3>Listado de usuarios</h3>
              {usersLoading ? <p>Cargando usuarios...</p> : (
                <div className="table">
                  <div className="table-row table-head">
                    <div>Email</div><div>Rol</div><div>Acción</div>
                  </div>
                  {usuarios.map((usuario) => (
                    <div key={usuario.id} className="table-row">
                      <div>{usuario.email}</div>
                      <div><span className={`role-badge ${usuario.role}`}>{usuario.role}</span></div>
                      <div>
                        <button
                          className="button small"
                          disabled={loadingAction || usuario.id === user.uid}
                          onClick={() => handleChangeUserRole(usuario.id, usuario.role)}
                        >
                          {usuario.role === "admin" ? "Hacer cajero" : "Hacer admin"}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* ════════════════════════════════════════════════════════════════════
          VISTA: REPORTES
      ════════════════════════════════════════════════════════════════════ */}
   {view === "reportes" && userRole === "admin" && (
        <section>
          <div className="section-header">
            <div>
              <h2>Reportes</h2>
              <p className="section-copy">Revisa el comportamiento de ventas del minimarket.</p>
            </div>
          </div>

          <div className="grid-4">
            <div className="card report-card"><p className="report-label">Ventas totales</p><p className="report-value">S/{totalVentas.toFixed(2)}</p></div>
            <div className="card report-card"><p className="report-label">Productos vendidos</p><p className="report-value">{productosVendidos}</p></div>
            <div className="card report-card"><p className="report-label">Stock total</p><p className="report-value">{stockTotal}</p></div>
            <div className="card report-card"><p className="report-label">Bajo stock</p><p className="report-value">{productosBajoStock}</p></div>
          </div>

          <div className="card" style={{ marginTop: 16 }}>
            <h3>Ventas por método de pago</h3>
            {(() => {
              const metodos = ["Efectivo", "Yape", "Plin", "Tarjeta"];
              const colores = {
                Efectivo: { bg: "#f0fdf4", color: "#166534" },
                Yape:     { bg: "#ede9fe", color: "#7c3aed" },
                Plin:     { bg: "#dbeafe", color: "#1d4ed8" },
                Tarjeta:  { bg: "#fef9c3", color: "#92400e" },
              };
              return (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, marginTop: 12 }}>
                  {metodos.map((metodo) => {
                    const ventasMetodo = ventas.filter((v) => v.metodoPago === metodo);
                    const totalMetodo = ventasMetodo.reduce((acc, v) => acc + Number(v.total || 0), 0);
                    return (
                      <div key={metodo} style={{ background: colores[metodo].bg, borderRadius: 10, padding: "14px 16px" }}>
                        <p style={{ fontSize: 12, color: colores[metodo].color, fontWeight: 600, marginBottom: 4 }}>{metodo}</p>
                        <p style={{ fontSize: 20, fontWeight: 700, color: colores[metodo].color }}>S/{totalMetodo.toFixed(2)}</p>
                        <p style={{ fontSize: 11, color: colores[metodo].color, opacity: 0.8 }}>{ventasMetodo.length} venta{ventasMetodo.length !== 1 ? "s" : ""}</p>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>

          <div className="card">
            <h3>Categorías en inventario</h3>
            {Object.entries(categoriasCount).length === 0
              ? <p className="note">No hay categorías registradas.</p>
              : (
                <div className="list-panel">
                  {Object.entries(categoriasCount).map(([categoria, total]) => (
                    <div key={categoria} className="list-item">
                      <div>
                        <strong>{categoria}</strong>
                        <p className="item-meta">{total} producto{total === 1 ? "" : "s"}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
          </div>

          <div className="card">
            <div className="section-header">
              <div>
                <h3>Cierre de caja</h3>
                <p className="section-copy">Registra las ventas del día y revisa el historial completo de cierres.</p>
              </div>
              <button className="button" type="button" onClick={handleCloseCashRegister} disabled={closeLoading}>
                {closeLoading ? "Guardando cierre..." : "Cerrar caja"}
              </button>
            </div>
            {cierres.length === 0 ? <p className="note">No hay cierres de caja registrados aún.</p> : (
              <div className="table">
                <div className="table-row table-head">
                  <div>Fecha</div><div>Ventas</div><div>Total</div><div>Usuario</div>
                </div>
                {cierres.map((cierre) => (
                  <div key={cierre.id} className="table-row">
                    <div>{cierre.fecha}</div>
                    <div>{cierre.ventasCount}</div>
                    <div>S/{Number(cierre.total).toFixed(2)}</div>
                    <div>{cierre.registradoPor}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card">
            <h3>Últimas ventas</h3>
            {ventas.length === 0 ? <p className="note">Aún no hay ventas registradas.</p> : (
              ventas.slice(-5).reverse().map((venta) => (
                <div key={venta.id} className="sale-item">
                  <div className="sale-summary">
                    <strong>S/{Number(venta.total).toFixed(2)}</strong>
                    <span>{venta.createdAt?.seconds ? new Date(venta.createdAt.seconds * 1000).toLocaleString() : "Sin fecha"}</span>
                  </div>
                  <p className="item-meta">{(venta.items || []).map((i) => `${i.nombre} x${i.cantidad}`).join(", ")}</p>
                </div>
              ))
            )}
          </div>
        </section>
      )}

{/* ── Categorías en inventario ── */}
          <div className="card">
            <h3>Categorías en inventario</h3>
            {Object.entries(categoriasCount).length === 0
              ? <p className="note">No hay categorías registradas.</p>
              : (
                <div className="list-panel">
                  {Object.entries(categoriasCount).map(([categoria, total]) => (
                    <div key={categoria} className="list-item">
                      <div>
                        <strong>{categoria}</strong>
                        <p className="item-meta">{total} producto{total === 1 ? "" : "s"}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
          </div>
          <div className="card">
            <div className="section-header">
              <div>
                <h3>Cierre de caja</h3>
                <p className="section-copy">Registra las ventas del día y revisa el historial completo de cierres.</p>
              </div>
              <button className="button" type="button" onClick={handleCloseCashRegister} disabled={closeLoading}>
                {closeLoading ? "Guardando cierre..." : "Cerrar caja"}
              </button>
            </div>
            {cierres.length === 0 ? <p className="note">No hay cierres de caja registrados aún.</p> : (
              <div className="table">
                <div className="table-row table-head">
                  <div>Fecha</div><div>Ventas</div><div>Total</div><div>Usuario</div>
                </div>
                {cierres.map((cierre) => (
                  <div key={cierre.id} className="table-row">
                    <div>{cierre.fecha}</div>
                    <div>{cierre.ventasCount}</div>
                    <div>S/{Number(cierre.total).toFixed(2)}</div>
                    <div>{cierre.registradoPor}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="card">
            <h3>Últimas ventas</h3>
            {ventas.length === 0 ? <p className="note">Aún no hay ventas registradas.</p> : (
              ventas.slice(-5).reverse().map((venta) => (
                <div key={venta.id} className="sale-item">
                  <div className="sale-summary">
                    <strong>S/{Number(venta.total).toFixed(2)}</strong>
                    <span>{venta.createdAt?.seconds ? new Date(venta.createdAt.seconds * 1000).toLocaleString() : "Sin fecha"}</span>
                  </div>
                  <p className="item-meta">{(venta.items || []).map((i) => `${i.nombre} x${i.cantidad}`).join(", ")}</p>
                </div>
              ))
            )}
          </div>
      {/* ════════════════════════════════════════════════════════════════════
          VISTA: AUDITORÍA
      ════════════════════════════════════════════════════════════════════ */}
      {view === "auditoria" && userRole === "admin" && (
        <section>
          <div className="section-header">
            <div>
              <h2>Registro de auditoría</h2>
              <p className="section-copy">Historial de todas las acciones realizadas en el sistema.</p>
            </div>
            <button className="button secondary" onClick={cargarAuditLog}>Actualizar</button>
          </div>
          <div className="card">
            {auditLog.length === 0 ? <p className="note">No hay registros aún.</p> : (
              <div className="table">
                <div className="table-row table-head">
                  <div>Fecha/Hora</div>
                  <div>Usuario</div>
                  <div>Acción</div>
                  <div>Detalle</div>
                </div>
                {auditLog.map((log) => (
                  <div key={log.id} className="table-row">
                    <div style={{ fontSize: 12 }}>
                      {log.timestamp?.seconds
                        ? new Date(log.timestamp.seconds * 1000).toLocaleString("es-PE")
                        : "—"}
                    </div>
                    <div style={{ fontSize: 12 }}>{log.usuario}</div>
                    <div>
                      <span className="role-badge" style={{
                        background:
                          log.accion.includes("VENTA") ? "#dbeafe" :
                          log.accion.includes("ELIMINAR") ? "#fee2e2" :
                          log.accion.includes("CIERRE") ? "#fef9c3" : "#f0fdf4",
                        color:
                          log.accion.includes("VENTA") ? "#1d4ed8" :
                          log.accion.includes("ELIMINAR") ? "#b91c1c" :
                          log.accion.includes("CIERRE") ? "#92400e" : "#166534",
                      }}>
                        {log.accion}
                      </span>
                    </div>
                    <div style={{ fontSize: 12, color: "#6b7280" }}>{log.detalle}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      {/* ── Modal QR escáner remoto ── */}
      {showQR && (
        <div
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
            display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100,
          }}
          onClick={() => setShowQR(false)}
        >
          <div
            style={{ background: "#fff", borderRadius: 16, padding: 32, textAlign: "center", maxWidth: 280 }}
            onClick={(e) => e.stopPropagation()}
          >
            <p style={{ marginBottom: 8, fontWeight: 700, fontSize: 16 }}>Escáner remoto</p>
            <p style={{ marginBottom: 16, fontSize: 13, color: "#6b7280" }}>
              Escanea con tu celular para abrir la cámara
            </p>
            <QRCode value={`${window.location.origin}/scanner/${sessionId}`} size={200} />
            <p style={{ marginTop: 12, fontSize: 11, color: "#9ca3af" }}>Sesión: {sessionId}</p>
            <button className="button secondary" style={{ marginTop: 16, width: "100%" }} onClick={() => setShowQR(false)}>
              Cerrar
            </button>
          </div>
        </div>
      )}

    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// LOGOUT helper (usado en inactivity timeout)
// ─────────────────────────────────────────────────────────────────────────────
// ✅ Agrega esto aquí
async function handleLogout() {
  try { 
    await signOut(auth); 
  } catch (e) { 
    console.error(e); 
  }
}

export default App;