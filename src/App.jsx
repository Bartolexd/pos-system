import { auth, db, rtdb } from "./firebase/firebase";
import { ref, onValue, remove } from "firebase/database";
import {
  collection, addDoc, getDocs, getDoc, setDoc,
  updateDoc, deleteDoc, doc, serverTimestamp,
  query, orderBy, limit,
} from "firebase/firestore";
import { useState, useEffect, useRef, useCallback, lazy, Suspense } from "react";
import { onAuthStateChanged, signOut, createUserWithEmailAndPassword, signInWithEmailAndPassword } from "firebase/auth";
import { QRCode } from "react-qr-code";
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, LineElement, PointElement, Title, Tooltip, Legend, Filler } from "chart.js";
import { Bar, Line } from "react-chartjs-2";

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, Title, Tooltip, Legend, Filler);

const Login = lazy(() => import("./Login"));
const INACTIVITY_TIMEOUT_MS = 15 * 60 * 1000;

async function registrarAccion(db, userEmail, accion, detalle = "") {
  try { await addDoc(collection(db, "auditLog"), { usuario: userEmail, accion, detalle, timestamp: serverTimestamp() }); }
  catch (e) { console.warn("auditLog error:", e); }
}

function getHoy() { const h = new Date(); h.setHours(0,0,0,0); return h; }
function getNombreDia(d) { return ["Dom","Lun","Mar","Mié","Jue","Vie","Sáb"][d.getDay()]; }
function getNombreMes(m) { return ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"][m]; }

function compressImage(file, maxSize = 400) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        let w = img.width, h = img.height;
        if (w > h) { if (w > maxSize) { h = h * maxSize / w; w = maxSize; } }
        else { if (h > maxSize) { w = w * maxSize / h; h = maxSize; } }
        canvas.width = w; canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", 0.7));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

function Toast({ msg, type }) {
  return <div className={`toast ${type === "error" ? "error" : ""}`}>{msg}</div>;
}

export default function App() {
  const [user, setUser] = useState(null);
  const [userRole, setUserRole] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [view, setView] = useState("venta");
  const [productos, setProductos] = useState([]);
  const [ventas, setVentas] = useState([]);
  const [usuarios, setUsuarios] = useState([]);
  const [cierres, setCierres] = useState([]);
  const [auditLog, setAuditLog] = useState([]);
  const [carrito, setCarrito] = useState([]);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [form, setForm] = useState({ nombre: "", precio: "", stock: "", codigo: "", categoria: "", marca: "", imagen: "" });
  const [editId, setEditId] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [loadingAction, setLoadingAction] = useState(false);
  const [usersLoading, setUsersLoading] = useState(false);
  const [newUserLoading, setNewUserLoading] = useState(false);
  const [closeLoading, setCloseLoading] = useState(false);
  const [scanLoading, setScanLoading] = useState(false);
  const [newUserForm, setNewUserForm] = useState({ email: "", password: "", confirmPassword: "", adminPassword: "", role: "cajero" });
  const [codigoInput, setCodigoInput] = useState("");
  const [scanActive, setScanActive] = useState(false);
  const [barcodeSupported, setBarcodeSupported] = useState(false);
  const [scannerError, setScannerError] = useState("");
  const videoRef = useRef(null);
  const codeReaderRef = useRef(null);
  const [sessionId] = useState(() => Math.random().toString(36).slice(2, 10).toUpperCase());
  const [scannerConectado, setScannerConectado] = useState(false);
  const [showQR, setShowQR] = useState(false);
  const [receiptData, setReceiptData] = useState(null);
  const [metodoPago, setMetodoPago] = useState("Efectivo");
  const [montoRecibido, setMontoRecibido] = useState("");
  const [toast, setToast] = useState(null);
  const [dashTab, setDashTab] = useState("hoy");
  const inactivityTimer = useRef(null);
  const productosRef = useRef([]);
  const [proveedores, setProveedores] = useState([]);
const [entradas, setEntradas] = useState([]);
const [formProveedor, setFormProveedor] = useState({ nombre: "", telefono: "", ruc: "", direccion: "" });
const [editProveedorId, setEditProveedorId] = useState(null);
const [formEntrada, setFormEntrada] = useState({ proveedorId: "", productoId: "", cantidad: "", precioCompra: "", notas: "", pagado: false });
const [proveedorTab, setProveedorTab] = useState("lista"); // "lista" | "nueva-entrada" | "deudas"

  const showToast = useCallback((msg, type = "ok") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  const resetInactivityTimer = useCallback(() => {
    if (inactivityTimer.current) clearTimeout(inactivityTimer.current);
    if (!user) return;
    inactivityTimer.current = setTimeout(async () => {
      await registrarAccion(db, user?.email || "desconocido", "CIERRE_INACTIVIDAD", "Sesión cerrada por inactividad");
      await signOut(auth);
      alert("Sesión cerrada por inactividad.");
    }, INACTIVITY_TIMEOUT_MS);
  }, [user]);

  useEffect(() => {
    if (!user) return;
    const eventos = ["mousemove", "keydown", "click", "scroll", "touchstart"];
    eventos.forEach((e) => window.addEventListener(e, resetInactivityTimer));
    resetInactivityTimer();
    return () => { eventos.forEach((e) => window.removeEventListener(e, resetInactivityTimer)); if (inactivityTimer.current) clearTimeout(inactivityTimer.current); };
  }, [user, resetInactivityTimer]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (!firebaseUser) { setUser(null); setUserRole(null); setAuthLoading(false); return; }
      setUser(firebaseUser);
      await loadUserRole(firebaseUser);
    });
    return unsubscribe;
  }, []);

  useEffect(() => { if (!user) return; cargarProductos(); cargarVentas(); }, [user]);

  useEffect(() => {
    if (userRole === "admin") { cargarUsuarios(); cargarCierres(); cargarAuditLog(); cargarProveedores();cargarEntradas(); }
    if (userRole === "cajero" && view !== "venta") setView("venta");
  }, [userRole]);

  useEffect(() => {
    if (!user) return;
    const sessionRef = ref(rtdb, `scan-sessions/${sessionId}`);
    const unsub = onValue(sessionRef, (snap) => {
      if (!snap.exists()) return;
      let code = snap.val().code;
      code = code.replace(/"/g, "").trim();
      setScannerConectado(true);
      const producto = productosRef.current.find((p) => String(p.codigo) === String(code) || p.id === code);
      if (!producto) { showToast(`Código ${code} no encontrado`, "error"); }
      else { handleAddToCart(producto); showToast(`✓ ${producto.nombre} agregado`); }
      setTimeout(() => remove(sessionRef), 500);
    });
    return () => unsub();
  }, [user, sessionId]);

  useEffect(() => {
    setBarcodeSupported(typeof navigator !== "undefined" && navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === "function");
  }, []);

  const loadUserRole = async (firebaseUser) => {
    setAuthLoading(true);
    try {
      const userRef = doc(db, "users", firebaseUser.uid);
      const userSnap = await getDoc(userRef);
      if (userSnap.exists()) { setUserRole(userSnap.data().role || "cajero"); }
      else {
        const usersSnapshot = await getDocs(collection(db, "users"));
        const role = usersSnapshot.empty ? "admin" : "cajero";
        await setDoc(userRef, { email: firebaseUser.email, role, createdAt: serverTimestamp() });
        setUserRole(role);
      }
    } catch (error) { setUserRole("cajero"); }
    finally { setAuthLoading(false); }
  };

  const cargarProductos = async () => {
    setCargando(true);
    try {
      const querySnapshot = await getDocs(collection(db, "productos"));
      const lista = querySnapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      setProductos(lista);
      productosRef.current = lista;
    } catch (error) { showToast("No se pudieron cargar los productos", "error"); }
    finally { setCargando(false); }
  };

  const cargarVentas = async () => {
    try { const qs = await getDocs(collection(db, "ventas")); setVentas(qs.docs.map((d) => ({ id: d.id, ...d.data() }))); }
    catch (e) { console.error(e); }
  };

  const cargarUsuarios = async () => {
    setUsersLoading(true);
    try { const qs = await getDocs(collection(db, "users")); setUsuarios(qs.docs.map((d) => ({ id: d.id, ...d.data() }))); }
    catch (e) { console.error(e); }
    finally { setUsersLoading(false); }
  };

  const cargarCierres = async () => {
    try {
      const qs = await getDocs(collection(db, "cierres"));
      const lista = qs.docs.map((d) => ({ id: d.id, ...d.data() }));
      lista.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
      setCierres(lista);
    } catch (e) { console.error(e); }
  };

  const cargarAuditLog = async () => {
    try {
      const q = query(collection(db, "auditLog"), orderBy("timestamp", "desc"), limit(50));
      const qs = await getDocs(q);
      setAuditLog(qs.docs.map((d) => ({ id: d.id, ...d.data() })));
    } catch (e) { console.error(e); }
  };

  const resetForm = () => setEditId(null) || setForm({ nombre: "", precio: "", stock: "", codigo: "", categoria: "", marca: "", imagen: "" });

  const handleProductSubmit = async (event) => {
    event.preventDefault();
    if (!form.nombre.trim() || !form.precio || !form.stock || !form.codigo.trim() || !form.categoria.trim()) { showToast("Completa todos los campos obligatorios", "error"); return; }
    if (Number(form.precio) <= 0 || Number(form.stock) < 0) { showToast("Precio y stock deben ser válidos", "error"); return; }
    const codigoExistente = productos.find((p) => p.codigo === form.codigo.trim() && p.id !== editId);
    if (codigoExistente) { showToast("Código ya asignado a otro producto", "error"); return; }
    const nuevoProducto = { nombre: form.nombre.trim(), precio: parseFloat(form.precio), stock: parseInt(form.stock, 10), codigo: form.codigo.trim(), categoria: form.categoria.trim(), marca: form.marca.trim(), imagen: form.imagen || "" };
    try {
      setLoadingAction(true);
      if (editId) { await updateDoc(doc(db, "productos", editId), nuevoProducto); await registrarAccion(db, user.email, "EDITAR_PRODUCTO", nuevoProducto.nombre); showToast("Producto actualizado"); }
      else { await addDoc(collection(db, "productos"), nuevoProducto); await registrarAccion(db, user.email, "AGREGAR_PRODUCTO", nuevoProducto.nombre); showToast("Producto agregado"); }
      resetForm(); cargarProductos();
    } catch (error) { showToast("No se pudo guardar el producto", "error"); }
    finally { setLoadingAction(false); }
  };

  const handleEditProduct = (producto) => {
    setEditId(producto.id);
    setForm({ nombre: producto.nombre, precio: String(producto.precio), stock: String(producto.stock), codigo: producto.codigo || "", categoria: producto.categoria || "", marca: producto.marca || "", imagen: producto.imagen || "" });
    setView("inventario");
  };

  const handleDeleteProduct = async (id) => {
    if (!window.confirm("¿Eliminar este producto?")) return;
    try { const prod = productos.find((p) => p.id === id); await deleteDoc(doc(db, "productos", id)); await registrarAccion(db, user.email, "ELIMINAR_PRODUCTO", prod?.nombre || ""); cargarProductos(); showToast("Producto eliminado"); }
    catch (e) { showToast("No se pudo eliminar", "error"); }
  };

  const handleAddToCart = (producto) => {
    if (producto.stock <= 0) { showToast("Sin stock disponible", "error"); return; }
    setCarrito((prev) => {
      const existente = prev.find((item) => item.id === producto.id);
      if (existente) { if (existente.cantidad >= producto.stock) { showToast("Stock insuficiente", "error"); return prev; } return prev.map((item) => item.id === producto.id ? { ...item, cantidad: item.cantidad + 1 } : item); }
      return [...prev, { id: producto.id, nombre: producto.nombre, precio: producto.precio, cantidad: 1, imagen: producto.imagen || "" }];
    });
  };

  const handleCartQuantity = (id, delta) => setCarrito((prev) => prev.map((item) => item.id === id ? { ...item, cantidad: Math.max(1, item.cantidad + delta) } : item).filter((item) => item.cantidad > 0));
  const handleRemoveFromCart = (id) => setCarrito((prev) => prev.filter((item) => item.id !== id));

  const handleAddProductByCode = (code) => {
    const trimmed = code.trim();
    if (!trimmed) { showToast("Ingresa un código válido", "error"); return; }
    const producto = productosRef.current.find((p) => String(p.codigo) === String(trimmed) || p.id === trimmed);
    if (!producto) { showToast(`Código ${trimmed} no encontrado`, "error"); return; }
    handleAddToCart(producto); setCodigoInput("");
  };

  const handleCheckout = async () => {
    if (carrito.length === 0) { showToast("Agrega productos al carrito", "error"); return; }
    const total = carrito.reduce((acc, item) => acc + item.precio * item.cantidad, 0);
    const items = carrito.map((item) => ({ productoId: item.id, nombre: item.nombre, precio: item.precio, cantidad: item.cantidad }));
    try {
      setLoadingAction(true);
      const ventaRef = await addDoc(collection(db, "ventas"), { items, total, createdAt: serverTimestamp(), cajero: user.email, metodoPago, montoRecibido: metodoPago === "Efectivo" ? Number(montoRecibido) : null, vuelto: metodoPago === "Efectivo" ? Number(montoRecibido) - total : 0 });
      await registrarAccion(db, user.email, "VENTA", `S/${total.toFixed(2)} - ${metodoPago}`);
      setReceiptData({ id: ventaRef.id, items, total, date: new Date().toLocaleString(), pagoPor: user.email, metodoPago });
      const productosMap = productos.reduce((map, p) => { map[p.id] = p; return map; }, {});
      await Promise.all(carrito.map((item) => updateDoc(doc(db, "productos", item.id), { stock: Math.max(0, productosMap[item.id].stock - item.cantidad) })));
      showToast("✓ Venta registrada");
      setCarrito([]); setMontoRecibido(""); setMetodoPago("Efectivo");
      cargarProductos(); cargarVentas();
    } catch (error) { showToast("No se pudo completar la venta", "error"); }
    finally { setLoadingAction(false); }
  };

  const stopBarcodeScanner = () => {
    setScanActive(false); setScanLoading(false);
    if (codeReaderRef.current?.reset) { codeReaderRef.current.reset(); codeReaderRef.current = null; }
    if (videoRef.current?.srcObject) { videoRef.current.srcObject.getTracks().forEach((t) => t.stop()); videoRef.current.srcObject = null; }
  };

  const scanFrame = async (detector) => {
    if (!scanActive || !videoRef.current) return;
    try { const detections = await detector.detect(videoRef.current); if (detections.length > 0) { stopBarcodeScanner(); handleAddProductByCode(detections[0].rawValue); return; } }
    catch (e) { setScannerError("No se pudo leer el código."); }
    requestAnimationFrame(() => scanFrame(detector));
  };

  const startBarcodeScanner = async () => {
    if (!barcodeSupported) { setScannerError("Este navegador no admite escaneo."); return; }
    try {
      setScannerError(""); setScanLoading(true);
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
      setScanActive(true);
      if ("BarcodeDetector" in window) { const detector = new window.BarcodeDetector({ formats: ["ean_13", "ean_8", "code_39", "code_128", "upc_a", "upc_e"] }); scanFrame(detector); }
      else {
        const { BrowserMultiFormatReader } = await import("@zxing/browser");
        const codeReader = new BrowserMultiFormatReader();
        codeReaderRef.current = codeReader;
        const devices = await BrowserMultiFormatReader.listVideoInputDevices();
        codeReader.decodeFromVideoDevice(devices[0]?.deviceId, videoRef.current, (result) => { if (result) { stopBarcodeScanner(); handleAddProductByCode(result.getText()); } });
      }
      setScanLoading(false);
    } catch (error) { setScannerError("No se pudo acceder a la cámara."); setScanLoading(false); stopBarcodeScanner(); }
  };

  const handleChangeUserRole = async (userId, currentRole) => {
    if (userId === user.uid) { showToast("No puedes cambiar tu propio rol", "error"); return; }
    try {
      setLoadingAction(true);
      const nextRole = currentRole === "admin" ? "cajero" : "admin";
      await updateDoc(doc(db, "users", userId), { role: nextRole });
      await registrarAccion(db, user.email, "CAMBIO_ROL", `→ ${nextRole}`);
      cargarUsuarios();
    } catch (e) { showToast("No se pudo actualizar el rol", "error"); }
    finally { setLoadingAction(false); }
  };

  const handleCreateWorker = async (event) => {
    event.preventDefault();
    if (!newUserForm.email.trim() || !newUserForm.password || !newUserForm.confirmPassword || !newUserForm.adminPassword) { showToast("Completa todos los campos", "error"); return; }
    if (newUserForm.password !== newUserForm.confirmPassword) { showToast("Las contraseñas no coinciden", "error"); return; }
    if (newUserForm.password.length < 6) { showToast("Mínimo 6 caracteres", "error"); return; }
    try {
      setNewUserLoading(true);
      const adminEmail = user.email;
      const credential = await createUserWithEmailAndPassword(auth, newUserForm.email.trim(), newUserForm.password);
      await setDoc(doc(db, "users", credential.user.uid), { email: newUserForm.email.trim(), role: newUserForm.role, createdAt: serverTimestamp() });
      await registrarAccion(db, adminEmail, "CREAR_USUARIO", `${newUserForm.email.trim()} - ${newUserForm.role}`);
      await signInWithEmailAndPassword(auth, adminEmail, newUserForm.adminPassword);
      cargarUsuarios(); showToast("Trabajador creado");
      setNewUserForm({ email: "", password: "", confirmPassword: "", adminPassword: "", role: "cajero" });
    } catch (error) { showToast(error.message || "No se pudo crear el trabajador", "error"); }
    finally { setNewUserLoading(false); }
  };

  const handleCloseCashRegister = async () => {
    if (!window.confirm("¿Cerrar caja?")) return;
    const today = new Date();
    const start = new Date(today); start.setHours(0,0,0,0);
    const end = new Date(today); end.setHours(23,59,59,999);
    const ventasHoy = ventas.filter((v) => { const s = v.createdAt?.seconds; if (!s) return false; const f = new Date(s * 1000); return f >= start && f <= end; });
    const totalHoy = ventasHoy.reduce((acc, v) => acc + Number(v.total || 0), 0);
    try {
      setCloseLoading(true);
      await addDoc(collection(db, "cierres"), { fecha: start.toISOString().slice(0,10), total: totalHoy, ventasCount: ventasHoy.length, registradoPor: user.email, createdAt: serverTimestamp() });
      await registrarAccion(db, user.email, "CIERRE_CAJA", `S/${totalHoy.toFixed(2)}`);
      await cargarCierres(); showToast("Cierre registrado");
    } catch (e) { showToast("No se pudo cerrar la caja", "error"); }
    finally { setCloseLoading(false); }
  };

  const handlePrintReceipt = (receipt) => {
    const itemsHtml = receipt.items.map((item) => `<tr><td>${item.nombre}</td><td>${item.cantidad}</td><td>S/${item.precio.toFixed(2)}</td><td>S/${(item.precio * item.cantidad).toFixed(2)}</td></tr>`).join("");
    const w = window.open("", "_blank", "width=600,height=800");
    if (!w) return;
    w.document.write(`<html><head><title>Recibo</title><style>body{font-family:Arial,sans-serif;padding:24px;color:#111}.shell{max-width:480px;margin:0 auto}.div{margin:16px 0;border-top:1px solid #eee}.meta{color:#666;font-size:13px;margin:2px 0}table{width:100%;border-collapse:collapse;margin-top:12px}td,th{padding:8px;border-bottom:1px solid #eee;text-align:left}th{background:#f8f8f8;font-weight:600}.tot td{font-weight:700}.note{color:#888;font-size:12px;margin-top:12px}</style></head><body><div class="shell"><h2>MiniMarket POS</h2><p class="meta">Av. Comercio 123 · Tel: 0000-0000</p><div class="div"></div><p class="meta">ID: ${receipt.id}</p><p class="meta">Fecha: ${receipt.date}</p><p class="meta">Cajero: ${receipt.pagoPor}</p><p class="meta">Método: ${receipt.metodoPago}</p><div class="div"></div><table><thead><tr><th>Producto</th><th>Cant.</th><th>Precio</th><th>Subtotal</th></tr></thead><tbody>${itemsHtml}<tr class="tot"><td colspan="3">Total</td><td>S/${receipt.total.toFixed(2)}</td></tr></tbody></table><div class="div"></div><p class="note">¡Gracias por su compra!</p></div></body></html>`);
    w.document.close(); w.focus(); w.print();
  };

  const hoy = getHoy();
  const ventasHoy = ventas.filter((v) => { const s = v.createdAt?.seconds; if (!s) return false; return new Date(s * 1000) >= hoy; });
  const totalHoy = ventasHoy.reduce((acc, v) => acc + Number(v.total || 0), 0);

  const semanaLabels = [], semanaData = [];
  for (let i = 6; i >= 0; i--) {
    const dia = new Date(hoy); dia.setDate(dia.getDate() - i);
    const diaFin = new Date(dia); diaFin.setHours(23,59,59,999);
    semanaLabels.push(getNombreDia(dia));
    semanaData.push(parseFloat(ventas.filter((v) => { const s = v.createdAt?.seconds; if (!s) return false; const f = new Date(s * 1000); return f >= dia && f <= diaFin; }).reduce((acc, v) => acc + Number(v.total || 0), 0).toFixed(2)));
  }

  const mesLabels = [], mesData = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i); d.setHours(0,0,0,0);
    const dFin = new Date(d); dFin.setMonth(dFin.getMonth() + 1); dFin.setDate(0); dFin.setHours(23,59,59,999);
    mesLabels.push(getNombreMes(d.getMonth()));
    mesData.push(parseFloat(ventas.filter((v) => { const s = v.createdAt?.seconds; if (!s) return false; const f = new Date(s * 1000); return f >= d && f <= dFin; }).reduce((acc, v) => acc + Number(v.total || 0), 0).toFixed(2)));
  }

  const topProductos = (() => {
    const contador = {};
    ventas.forEach((v) => (v.items || []).forEach((item) => { if (!contador[item.nombre]) contador[item.nombre] = { cantidad: 0, total: 0 }; contador[item.nombre].cantidad += item.cantidad; contador[item.nombre].total += item.precio * item.cantidad; }));
    return Object.entries(contador).map(([nombre, data]) => ({ nombre, ...data })).sort((a, b) => b.cantidad - a.cantidad).slice(0, 8);
  })();
  const cargarProveedores = async () => {
  try {
    const qs = await getDocs(collection(db, "proveedores"));
    setProveedores(qs.docs.map(d => ({ id: d.id, ...d.data() })));
  } catch (e) { console.error(e); }
};

const cargarEntradas = async () => {
  try {
    const qs = await getDocs(collection(db, "entradas"));
    const lista = qs.docs.map(d => ({ id: d.id, ...d.data() }));
    lista.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
    setEntradas(lista);
  } catch (e) { console.error(e); }
};

const handleGuardarProveedor = async (e) => {
  e.preventDefault();
  if (!formProveedor.nombre.trim()) { showToast("El nombre es obligatorio", "error"); return; }
  try {
    setLoadingAction(true);
    if (editProveedorId) {
      await updateDoc(doc(db, "proveedores", editProveedorId), formProveedor);
      showToast("Proveedor actualizado");
    } else {
      await addDoc(collection(db, "proveedores"), { ...formProveedor, createdAt: serverTimestamp() });
      showToast("Proveedor agregado");
    }
    setFormProveedor({ nombre: "", telefono: "", ruc: "", direccion: "" });
    setEditProveedorId(null);
    cargarProveedores();
  } catch (e) { showToast("No se pudo guardar", "error"); }
  finally { setLoadingAction(false); }
};

const handleEliminarProveedor = async (id) => {
  if (!window.confirm("¿Eliminar este proveedor?")) return;
  try {
    await deleteDoc(doc(db, "proveedores", id));
    cargarProveedores();
    showToast("Proveedor eliminado");
  } catch (e) { showToast("No se pudo eliminar", "error"); }
};

const handleRegistrarEntrada = async (e) => {
  e.preventDefault();
  if (!formEntrada.proveedorId || !formEntrada.productoId || !formEntrada.cantidad || !formEntrada.precioCompra) {
    showToast("Completa todos los campos", "error"); return;
  }
  const cantidad = parseInt(formEntrada.cantidad);
  const precioCompra = parseFloat(formEntrada.precioCompra);
  const producto = productos.find(p => p.id === formEntrada.productoId);
  const proveedor = proveedores.find(p => p.id === formEntrada.proveedorId);
  if (!producto || !proveedor) { showToast("Producto o proveedor no encontrado", "error"); return; }
  try {
    setLoadingAction(true);
    // Registrar entrada
    await addDoc(collection(db, "entradas"), {
      proveedorId: formEntrada.proveedorId,
      proveedorNombre: proveedor.nombre,
      productoId: formEntrada.productoId,
      productoNombre: producto.nombre,
      cantidad,
      precioCompra,
      total: cantidad * precioCompra,
      notas: formEntrada.notas,
      pagado: formEntrada.pagado,
      createdAt: serverTimestamp(),
    });
    // Actualizar stock automáticamente
    const nuevoStock = (producto.stock || 0) + cantidad;
    await updateDoc(doc(db, "productos", formEntrada.productoId), { stock: nuevoStock });
    await registrarAccion(db, user.email, "ENTRADA_MERCADERIA", `${producto.nombre} x${cantidad} de ${proveedor.nombre}`);
    showToast(`✓ Stock de ${producto.nombre} actualizado a ${nuevoStock}`);
    setFormEntrada({ proveedorId: "", productoId: "", cantidad: "", precioCompra: "", notas: "", pagado: false });
    cargarEntradas();
    cargarProductos();
  } catch (e) { showToast("No se pudo registrar la entrada", "error"); }
  finally { setLoadingAction(false); }
};

const handleMarcarPagado = async (entradaId, pagado) => {
  try {
    await updateDoc(doc(db, "entradas", entradaId), { pagado: !pagado });
    cargarEntradas();
    showToast(!pagado ? "Marcado como pagado" : "Marcado como pendiente");
  } catch (e) { showToast("Error al actualizar", "error"); }
};

  const totalVentas = ventas.reduce((acc, v) => acc + Number(v.total || 0), 0);
  const productosVendidos = ventas.reduce((acc, v) => acc + (v.items || []).reduce((s, i) => s + i.cantidad, 0), 0);
  const stockTotal = productos.reduce((acc, p) => acc + Number(p.stock || 0), 0);
  const productosBajoStock = productos.filter((p) => p.stock <= 3).length;
  const categoriasCount = productos.reduce((acc, p) => { const cat = p.categoria || "Sin categoría"; acc[cat] = (acc[cat] || 0) + 1; return acc; }, {});
  const totalVenta = carrito.reduce((acc, item) => acc + item.precio * item.cantidad, 0);
  const categoriasDisponibles = Array.from(new Set(productos.map((p) => p.categoria).filter(Boolean)));
  const productosFiltrados = productos.filter((p) => { const texto = `${p.nombre} ${p.categoria || ""} ${p.marca || ""} ${p.codigo || ""}`.toLowerCase(); return texto.includes(search.toLowerCase()) && (categoryFilter === "all" || (p.categoria || "").toLowerCase() === categoryFilter.toLowerCase()); });

  if (authLoading) return <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#0a0a0f", color: "#888" }}>Cargando...</div>;
  if (!user) return <Suspense fallback={<div style={{ minHeight: "100vh", background: "#0a0a0f" }} />}><Login /></Suspense>;
  if (userRole === null) return <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#0a0a0f", color: "#888" }}>Cargando usuario...</div>;

  const navItems = [
    { key: "venta", icon: "🛒", label: "Venta" },
    { key: "inventario", icon: "📦", label: "Inventario", adminOnly: true },
    { key: "estadisticas", icon: "📊", label: "Estadísticas", adminOnly: true },
    { key: "usuarios", icon: "👥", label: "Usuarios", adminOnly: true },
    { key: "reportes", icon: "📋", label: "Reportes", adminOnly: true },
    { key: "auditoria", icon: "🔒", label: "Auditoría", adminOnly: true },
    { key: "proveedores", icon: "🚚", label: "Proveedores", adminOnly: true },
  ];

  return (
    <div className="app-layout">
      <aside className="sidebar">
        <div className="sidebar-logo">
          <h1>mini<span>POS</span></h1>
          <p>Sistema de ventas</p>
        </div>
        <div className="sidebar-user">
          <div className="email">{user.email}</div>
          <div className="role">
            <span className="role-dot" />
            {userRole}
            {scannerConectado && <span style={{ fontSize: 10, color: "#39ff8f", marginLeft: 4 }}>· escáner</span>}
          </div>
        </div>
        <nav className="sidebar-nav">
          <div className="nav-section-label">Principal</div>
          {navItems.filter(n => !n.adminOnly || userRole === "admin").map((n) => (
            <button key={n.key} className={`nav-btn ${view === n.key ? "active" : ""}`} onClick={() => setView(n.key)}>
              <span className="nav-icon">{n.icon}</span>{n.label}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button className="nav-btn" onClick={() => setShowQR(true)}><span className="nav-icon">📱</span> Escáner QR</button>
          <button className="nav-btn" onClick={async () => { await signOut(auth); }}><span className="nav-icon">🚪</span> Cerrar sesión</button>
        </div>
      </aside>

      <main className="main-content">
        <div className="topbar">
          <div className="topbar-title">{navItems.find(n => n.key === view)?.icon} {navItems.find(n => n.key === view)?.label}</div>
          <div className="topbar-actions">
            {view === "inventario" && <button className="btn btn-sm btn-primary" onClick={() => { resetForm(); setView("inventario"); }}>+ Nuevo producto</button>}
          </div>
        </div>

        <div className="page-content">

          {view === "venta" && (
            <>
              <div className="kpi-grid">
                <div className="kpi-card"><div className="kpi-label">Ventas hoy</div><div className="kpi-value green">S/{totalHoy.toFixed(2)}</div></div>
                <div className="kpi-card"><div className="kpi-label">Transacciones</div><div className="kpi-value">{ventasHoy.length}</div></div>
                <div className="kpi-card"><div className="kpi-label">En carrito</div><div className="kpi-value">{carrito.length} items</div></div>
                <div className="kpi-card"><div className="kpi-label">Bajo stock</div><div className={`kpi-value ${productosBajoStock > 0 ? "red" : ""}`}>{productosBajoStock}</div></div>
              </div>
              <div className="grid-2">
                <div className="card">
                  <h3>Productos</h3>
                  <div className="barcode-section">
                    <div className="barcode-row">
                      <input className="input" placeholder="Código de barras..." value={codigoInput} onChange={(e) => setCodigoInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleAddProductByCode(codigoInput)} />
                      <button className="btn btn-sm" onClick={() => handleAddProductByCode(codigoInput)}>Agregar</button>
                      <button className="btn btn-sm" onClick={startBarcodeScanner} disabled={scanActive || scanLoading}>{scanActive ? "..." : "📷"}</button>
                      {scanActive && <button className="btn btn-sm btn-danger" onClick={stopBarcodeScanner}>✕</button>}
                    </div>
                    {scannerError && <p className="error-text">{scannerError}</p>}
                    {scanActive && <div className="scanner-preview"><video ref={videoRef} className="scanner-video" playsInline muted /></div>}
                  </div>
                  <input className="input" placeholder="Buscar producto..." value={search} onChange={(e) => setSearch(e.target.value)} style={{ marginBottom: 12 }} />
                  {cargando ? <p className="note">Cargando...</p> : (
                    <div className="product-grid">
                      {productosFiltrados.map((producto) => (
                        <div key={producto.id} className={`product-card ${producto.stock <= 0 ? "out-of-stock" : ""}`} onClick={() => handleAddToCart(producto)}>
                          <div className="product-img">{producto.imagen ? <img src={producto.imagen} alt={producto.nombre} /> : <span>📦</span>}</div>
                          <div className="product-info">
                            <div className="product-name">{producto.nombre}</div>
                            <div className="product-price">S/{producto.precio.toFixed(2)}</div>
                            <div className={`product-stock ${producto.stock <= 3 ? "low" : ""}`}>{producto.stock <= 0 ? "Sin stock" : `Stock: ${producto.stock}`}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="card">
                  <h3>Carrito {carrito.length > 0 && `(${carrito.length})`}</h3>
                  {carrito.length === 0 ? <p className="note" style={{ textAlign: "center", padding: "32px 0" }}>El carrito está vacío.<br />Toca un producto para agregarlo.</p> : (
                    <>
                      <div className="cart-list">
                        {carrito.map((item) => (
                          <div key={item.id} className="cart-item">
                            <div className="cart-item-img">{item.imagen ? <img src={item.imagen} alt={item.nombre} /> : "📦"}</div>
                            <div className="cart-item-info"><div className="cart-item-name">{item.nombre}</div><div className="cart-item-price">S/{item.precio.toFixed(2)} c/u</div></div>
                            <div className="cart-qty">
                              <button className="qty-btn" onClick={() => handleCartQuantity(item.id, -1)}>−</button>
                              <span className="qty-num">{item.cantidad}</span>
                              <button className="qty-btn" onClick={() => handleCartQuantity(item.id, +1)}>+</button>
                            </div>
                            <span className="cart-subtotal">S/{(item.precio * item.cantidad).toFixed(2)}</span>
                            <button className="qty-btn" onClick={() => handleRemoveFromCart(item.id)} style={{ color: "#ff6b6b" }}>✕</button>
                          </div>
                        ))}
                      </div>
                      <div className="cart-total-bar">
                        <div className="payment-methods">
                          {["Efectivo", "Yape", "Plin", "Tarjeta"].map((m) => (
                            <button key={m} className={`pay-btn ${metodoPago === m ? "active" : ""}`} onClick={() => setMetodoPago(m)}>{m}</button>
                          ))}
                        </div>
                        {metodoPago === "Efectivo" && (
                          <div style={{ marginBottom: 10 }}>
                            <input className="input" type="number" min={totalVenta} step="0.50" placeholder={`Monto recibido (min S/${totalVenta.toFixed(2)})`} value={montoRecibido} onChange={(e) => setMontoRecibido(e.target.value)} />
                            {montoRecibido && Number(montoRecibido) >= totalVenta && (
                              <div style={{ marginTop: 8, padding: "8px 12px", background: "#1a2e20", borderRadius: 8, display: "flex", justifyContent: "space-between" }}>
                                <span style={{ fontSize: 13, color: "#888" }}>Vuelto</span>
                                <strong style={{ color: "#39ff8f" }}>S/{(Number(montoRecibido) - totalVenta).toFixed(2)}</strong>
                              </div>
                            )}
                            {montoRecibido && Number(montoRecibido) < totalVenta && (
                              <div style={{ marginTop: 8, padding: "8px 12px", background: "#2e1a1a", borderRadius: 8 }}>
                                <span style={{ fontSize: 12, color: "#ff6b6b" }}>Falta S/{(totalVenta - Number(montoRecibido)).toFixed(2)}</span>
                              </div>
                            )}
                          </div>
                        )}
                        <div className="cart-total-main"><span>Total</span><span>S/{totalVenta.toFixed(2)}</span></div>
                        <button className="btn btn-primary" style={{ width: "100%", marginTop: 12 }} disabled={loadingAction || (metodoPago === "Efectivo" && (!montoRecibido || Number(montoRecibido) < totalVenta))} onClick={handleCheckout}>
                          {loadingAction ? "Procesando..." : `Cobrar · ${metodoPago}`}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
              {receiptData && (
                <div className="receipt-card">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                    <h3 style={{ margin: 0, fontSize: 14, color: "#39ff8f" }}>✓ Venta registrada</h3>
                    <button className="btn btn-sm" onClick={() => handlePrintReceipt(receiptData)}>🖨️ Imprimir</button>
                  </div>
                  <p style={{ fontSize: 12, color: "#555" }}>ID: {receiptData.id} · {receiptData.date} · {receiptData.metodoPago}</p>
                  <div className="receipt-items">
                    {receiptData.items.map((item) => (
                      <div key={item.productoId} className="receipt-line"><span>{item.nombre} x{item.cantidad}</span><span>S/{(item.precio * item.cantidad).toFixed(2)}</span></div>
                    ))}
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, paddingTop: 8, borderTop: "1px solid #1e1e2e" }}>
                    <span>Total</span><span style={{ color: "#39ff8f" }}>S/{receiptData.total.toFixed(2)}</span>
                  </div>
                </div>
              )}
            </>
          )}

          {view === "inventario" && userRole === "admin" && (
            <div className="grid-2">
              <div className="card">
                <h3>{editId ? "Editar producto" : "Agregar producto"}</h3>
                <form onSubmit={handleProductSubmit} className="form-grid">
                  <div>
                    <div className="img-upload-area" onClick={() => document.getElementById("img-input").click()}>
                      {form.imagen ? <img src={form.imagen} className="img-preview" alt="preview" /> : <div style={{ color: "#555", fontSize: 13 }}>📷 Toca para subir foto del producto</div>}
                      <div style={{ fontSize: 11, color: "#444", marginTop: 4 }}>Se comprime automáticamente</div>
                    </div>
                    <input id="img-input" type="file" accept="image/*" style={{ display: "none" }} onChange={async (e) => { const file = e.target.files[0]; if (!file) return; const base64 = await compressImage(file); setForm(f => ({ ...f, imagen: base64 })); }} />
                    {form.imagen && <button type="button" className="btn btn-sm btn-danger" style={{ width: "100%", marginTop: 6 }} onClick={() => setForm(f => ({ ...f, imagen: "" }))}>Quitar imagen</button>}
                  </div>
                  <input className="input" placeholder="Nombre del producto *" value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} />
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    <input className="input" type="number" placeholder="Precio (S/) *" min="0" step="0.01" value={form.precio} onChange={(e) => setForm({ ...form, precio: e.target.value })} />
                    <input className="input" type="number" placeholder="Stock *" min="0" value={form.stock} onChange={(e) => setForm({ ...form, stock: e.target.value })} />
                  </div>
                  <input className="input" placeholder="Código de barras *" value={form.codigo} onChange={(e) => setForm({ ...form, codigo: e.target.value })} />
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    <input className="input" placeholder="Categoría *" value={form.categoria} onChange={(e) => setForm({ ...form, categoria: e.target.value })} />
                    <input className="input" placeholder="Marca" value={form.marca} onChange={(e) => setForm({ ...form, marca: e.target.value })} />
                  </div>
                  <div className="form-actions">
                    <button className="btn btn-primary" type="submit" disabled={loadingAction} style={{ flex: 1 }}>{loadingAction ? "Guardando..." : editId ? "Actualizar" : "Agregar producto"}</button>
                    {editId && <button className="btn" type="button" onClick={resetForm}>Cancelar</button>}
                  </div>
                </form>
              </div>
              <div className="card">
                <h3>Inventario ({productosFiltrados.length} productos)</h3>
                <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                  <input className="input" placeholder="Buscar..." value={search} onChange={(e) => setSearch(e.target.value)} />
                  <select className="input" style={{ width: "auto", minWidth: 120 }} value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
                    <option value="all">Todas</option>
                    {categoriasDisponibles.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
                  </select>
                </div>
                {cargando ? <p className="note">Cargando...</p> : (
                  <div className="list-panel">
                    {productosFiltrados.length === 0 ? <p className="note">No hay productos.</p> : productosFiltrados.map((producto) => (
                      <div key={producto.id} className="list-item">
                        <div className="list-item-img">{producto.imagen ? <img src={producto.imagen} alt={producto.nombre} /> : "📦"}</div>
                        <div className="list-item-info">
                          <div className="list-item-name">{producto.nombre}</div>
                          <div className="list-item-meta">S/{producto.precio} · stock {producto.stock}{producto.stock <= 3 && <span style={{ color: "#ff6b6b", marginLeft: 4 }}>⚠</span>} · {producto.codigo || "sin código"}{producto.categoria ? ` · ${producto.categoria}` : ""}</div>
                        </div>
                        <div className="list-item-actions">
                          <button className="btn btn-xs" onClick={() => handleEditProduct(producto)}>Editar</button>
                          <button className="btn btn-xs btn-danger" onClick={() => handleDeleteProduct(producto.id)}>Eliminar</button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {view === "estadisticas" && userRole === "admin" && (
            <>
              <div className="kpi-grid">
                <div className="kpi-card"><div className="kpi-label">Ventas hoy</div><div className="kpi-value green">S/{totalHoy.toFixed(2)}</div><div style={{ fontSize: 11, color: "#555", marginTop: 4 }}>{ventasHoy.length} transacciones</div></div>
                <div className="kpi-card"><div className="kpi-label">Esta semana</div><div className="kpi-value">S/{semanaData.reduce((a, b) => a + b, 0).toFixed(2)}</div></div>
                <div className="kpi-card"><div className="kpi-label">Total histórico</div><div className="kpi-value">S/{totalVentas.toFixed(2)}</div></div>
                <div className="kpi-card"><div className="kpi-label">Bajo stock</div><div className={`kpi-value ${productosBajoStock > 0 ? "red" : ""}`}>{productosBajoStock}</div></div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                {[{ key: "hoy", label: "📋 Hoy" }, { key: "semana", label: "📊 Semana" }, { key: "mes", label: "📈 Mes" }, { key: "top", label: "🏆 Top" }].map((t) => (
                  <button key={t.key} className={`btn btn-sm ${dashTab === t.key ? "btn-primary" : ""}`} onClick={() => setDashTab(t.key)}>{t.label}</button>
                ))}
              </div>
              {dashTab === "hoy" && (
                <div className="card">
                  <h3>Ventas del día</h3>
                  {ventasHoy.length === 0 ? <p className="note">No hay ventas hoy.</p> : (
                    <>
                      <div style={{ display: "flex", gap: 24, padding: "10px 14px", background: "#1a2e20", borderRadius: 8, marginBottom: 12, fontSize: 13 }}>
                        <span><strong>{ventasHoy.length}</strong> ventas</span>
                        <span>Total: <strong style={{ color: "#39ff8f" }}>S/{totalHoy.toFixed(2)}</strong></span>
                        <span>Promedio: <strong>S/{(totalHoy / ventasHoy.length).toFixed(2)}</strong></span>
                      </div>
                      <div className="list-panel">
                        {[...ventasHoy].reverse().map((venta) => (
                          <div key={venta.id} className="sale-item">
                            <div className="sale-summary">
                              <strong>S/{Number(venta.total).toFixed(2)}</strong>
                              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                <span style={{ fontSize: 12, color: "#555" }}>{venta.createdAt?.seconds ? new Date(venta.createdAt.seconds * 1000).toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit" }) : ""}</span>
                                {venta.metodoPago && <span className={`badge badge-${venta.metodoPago === "Yape" ? "purple" : venta.metodoPago === "Plin" ? "blue" : venta.metodoPago === "Tarjeta" ? "yellow" : "green"}`}>{venta.metodoPago}</span>}
                              </div>
                            </div>
                            <p style={{ fontSize: 12, color: "#555", marginTop: 2 }}>{(venta.items || []).map((i) => `${i.nombre} x${i.cantidad}`).join(", ")}</p>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}
              {dashTab === "semana" && (
                <div className="card"><h3>Últimos 7 días</h3>
                  <div style={{ height: 280 }}>
                    <Bar data={{ labels: semanaLabels, datasets: [{ label: "S/", data: semanaData, backgroundColor: semanaLabels.map((_, i) => i === 6 ? "rgba(57,255,143,0.85)" : "rgba(57,255,143,0.25)"), borderColor: "rgba(57,255,143,1)", borderWidth: 1, borderRadius: 6 }] }} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => ` S/${ctx.raw.toFixed(2)}` } } }, scales: { y: { beginAtZero: true, ticks: { color: "#555", callback: (v) => `S/${v}` }, grid: { color: "#1e1e2e" } }, x: { ticks: { color: "#555" }, grid: { color: "#1e1e2e" } } } }} />
                  </div>
                </div>
              )}
              {dashTab === "mes" && (
                <div className="card"><h3>Últimos 6 meses</h3>
                  <div style={{ height: 280 }}>
                    <Line data={{ labels: mesLabels, datasets: [{ label: "S/", data: mesData, borderColor: "rgba(57,255,143,1)", backgroundColor: "rgba(57,255,143,0.08)", borderWidth: 2, pointBackgroundColor: "rgba(57,255,143,1)", pointRadius: 5, fill: true, tension: 0.4 }] }} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => ` S/${ctx.raw.toFixed(2)}` } } }, scales: { y: { beginAtZero: true, ticks: { color: "#555", callback: (v) => `S/${v}` }, grid: { color: "#1e1e2e" } }, x: { ticks: { color: "#555" }, grid: { color: "#1e1e2e" } } } }} />
                  </div>
                </div>
              )}
              {dashTab === "top" && (
                <div className="card"><h3>Top 8 productos</h3>
                  {topProductos.length === 0 ? <p className="note">Sin ventas aún.</p> : (
                    <>
                      <div style={{ height: 280 }}>
                        <Bar data={{ labels: topProductos.map((p) => p.nombre.length > 14 ? p.nombre.slice(0, 12) + "…" : p.nombre), datasets: [{ label: "Unidades", data: topProductos.map((p) => p.cantidad), backgroundColor: "rgba(167,139,250,0.7)", borderColor: "rgba(167,139,250,1)", borderWidth: 1, borderRadius: 6 }] }} options={{ responsive: true, maintainAspectRatio: false, indexAxis: "y", plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true, ticks: { color: "#555", stepSize: 1 }, grid: { color: "#1e1e2e" } }, y: { ticks: { color: "#aaa" }, grid: { color: "#1e1e2e" } } } }} />
                      </div>
                      <div style={{ marginTop: 12 }}>
                        {topProductos.map((p, i) => (
                          <div key={p.nombre} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid #1e1e2e", fontSize: 13 }}>
                            <span><strong style={{ color: "#555", marginRight: 8 }}>#{i + 1}</strong>{p.nombre}</span>
                            <span style={{ color: "#555" }}>{p.cantidad} uds · <span style={{ color: "#39ff8f" }}>S/{p.total.toFixed(2)}</span></span>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}
            </>
          )}

          {view === "usuarios" && userRole === "admin" && (
            <div className="grid-2">
              <div className="card">
                <h3>Crear trabajador</h3>
                <form onSubmit={handleCreateWorker} className="form-grid">
                  <input className="input" type="email" placeholder="Email" value={newUserForm.email} onChange={(e) => setNewUserForm({ ...newUserForm, email: e.target.value })} />
                  <input className="input" type="password" placeholder="Contraseña" value={newUserForm.password} onChange={(e) => setNewUserForm({ ...newUserForm, password: e.target.value })} />
                  <input className="input" type="password" placeholder="Confirmar contraseña" value={newUserForm.confirmPassword} onChange={(e) => setNewUserForm({ ...newUserForm, confirmPassword: e.target.value })} />
                  <select className="input" value={newUserForm.role} onChange={(e) => setNewUserForm({ ...newUserForm, role: e.target.value })}><option value="cajero">Cajero</option><option value="admin">Admin</option></select>
                  <input className="input" type="password" placeholder="Tu contraseña admin" value={newUserForm.adminPassword} onChange={(e) => setNewUserForm({ ...newUserForm, adminPassword: e.target.value })} />
                  <button className="btn btn-primary" type="submit" disabled={newUserLoading}>{newUserLoading ? "Creando..." : "Crear trabajador"}</button>
                </form>
              </div>
              <div className="card">
                <h3>Usuarios del sistema</h3>
                {usersLoading ? <p className="note">Cargando...</p> : (
                  <table className="table">
                    <thead><tr><th>Email</th><th>Rol</th><th>Acción</th></tr></thead>
                    <tbody>
                      {usuarios.map((u) => (
                        <tr key={u.id}>
                          <td style={{ fontSize: 12 }}>{u.email}</td>
                          <td><span className={`role-badge ${u.role}`}>{u.role}</span></td>
                          <td><button className="btn btn-xs" disabled={loadingAction || u.id === user.uid} onClick={() => handleChangeUserRole(u.id, u.role)}>{u.role === "admin" ? "→ cajero" : "→ admin"}</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}

          {view === "reportes" && userRole === "admin" && (
            <>
              <div className="kpi-grid">
                <div className="kpi-card"><div className="kpi-label">Ventas totales</div><div className="kpi-value green">S/{totalVentas.toFixed(2)}</div></div>
                <div className="kpi-card"><div className="kpi-label">Productos vendidos</div><div className="kpi-value">{productosVendidos}</div></div>
                <div className="kpi-card"><div className="kpi-label">Stock total</div><div className="kpi-value">{stockTotal}</div></div>
                <div className="kpi-card"><div className="kpi-label">Bajo stock</div><div className={`kpi-value ${productosBajoStock > 0 ? "red" : ""}`}>{productosBajoStock}</div></div>
              </div>
              <div className="card">
                <h3>Ventas por método de pago</h3>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 10, marginTop: 8 }}>
                  {[{ m: "Efectivo", bg: "#1a2e20", color: "#39ff8f" }, { m: "Yape", bg: "#1f1a3a", color: "#a78bfa" }, { m: "Plin", bg: "#1a1f3a", color: "#7cb9ff" }, { m: "Tarjeta", bg: "#2e280a", color: "#ffd700" }].map(({ m, bg, color }) => {
                    const vm = ventas.filter((v) => v.metodoPago === m);
                    const tm = vm.reduce((acc, v) => acc + Number(v.total || 0), 0);
                    return (
                      <div key={m} style={{ background: bg, borderRadius: 10, padding: "12px 14px" }}>
                        <div style={{ fontSize: 11, color, fontWeight: 600, marginBottom: 4 }}>{m}</div>
                        <div style={{ fontSize: 18, fontWeight: 700, color }}>S/{tm.toFixed(2)}</div>
                        <div style={{ fontSize: 11, color, opacity: 0.7 }}>{vm.length} venta{vm.length !== 1 ? "s" : ""}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="card">
                <h3>Categorías en inventario</h3>
                {Object.entries(categoriasCount).length === 0 ? <p className="note">Sin categorías.</p> : Object.entries(categoriasCount).map(([cat, total]) => (
                  <div key={cat} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid #1e1e2e", fontSize: 13 }}>
                    <span>{cat}</span><span className="badge badge-green">{total} producto{total !== 1 ? "s" : ""}</span>
                  </div>
                ))}
              </div>
              <div className="card">
                <div className="section-header">
                  <div><h3 style={{ margin: 0 }}>Cierres de caja</h3></div>
                  <button className="btn btn-sm" onClick={handleCloseCashRegister} disabled={closeLoading}>{closeLoading ? "Guardando..." : "💰 Cerrar caja"}</button>
                </div>
                {cierres.length === 0 ? <p className="note">Sin cierres.</p> : (
                  <table className="table">
                    <thead><tr><th>Fecha</th><th>Ventas</th><th>Total</th><th>Usuario</th></tr></thead>
                    <tbody>
                      {cierres.map((c) => (<tr key={c.id}><td>{c.fecha}</td><td>{c.ventasCount}</td><td style={{ color: "#39ff8f" }}>S/{Number(c.total).toFixed(2)}</td><td style={{ fontSize: 12, color: "#555" }}>{c.registradoPor}</td></tr>))}
                    </tbody>
                  </table>
                )}
              </div>
              <div className="card">
                <h3>Últimas ventas</h3>
                {ventas.length === 0 ? <p className="note">Sin ventas.</p> : (
                  <div className="list-panel">
                    {ventas.slice(-10).reverse().map((venta) => (
                      <div key={venta.id} className="sale-item">
                        <div className="sale-summary"><strong>S/{Number(venta.total).toFixed(2)}</strong><span style={{ fontSize: 12, color: "#555" }}>{venta.createdAt?.seconds ? new Date(venta.createdAt.seconds * 1000).toLocaleString() : "Sin fecha"}</span></div>
                        <p style={{ fontSize: 12, color: "#555" }}>{(venta.items || []).map((i) => `${i.nombre} x${i.cantidad}`).join(", ")}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

          {view === "auditoria" && userRole === "admin" && (
            <div className="card">
              <div className="section-header">
                <h3 style={{ margin: 0 }}>Registro de auditoría</h3>
                <button className="btn btn-sm" onClick={cargarAuditLog}>Actualizar</button>
              </div>
              {auditLog.length === 0 ? <p className="note">Sin registros.</p> : (
                <table className="table">
                  <thead><tr><th>Fecha/Hora</th><th>Usuario</th><th>Acción</th><th>Detalle</th></tr></thead>
                  <tbody>
                    {auditLog.map((log) => (
                      <tr key={log.id}>
                        <td style={{ fontSize: 11, color: "#555" }}>{log.timestamp?.seconds ? new Date(log.timestamp.seconds * 1000).toLocaleString("es-PE") : "—"}</td>
                        <td style={{ fontSize: 11 }}>{log.usuario}</td>
                        <td><span className={`badge ${log.accion.includes("VENTA") ? "badge-blue" : log.accion.includes("ELIMINAR") ? "badge-red" : log.accion.includes("CIERRE") ? "badge-yellow" : "badge-green"}`}>{log.accion}</span></td>
                        <td style={{ fontSize: 11, color: "#555" }}>{log.detalle}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

        </div>
      </main>
      {view === "proveedores" && userRole === "admin" && (
  <>
    {/* Tabs */}
    <div style={{ display: "flex", gap: 8 }}>
      {[
        { key: "lista", label: "📋 Proveedores" },
        { key: "nueva-entrada", label: "📥 Registrar entrada" },
        { key: "deudas", label: "💳 Deudas" },
      ].map(t => (
        <button key={t.key} className={`btn btn-sm ${proveedorTab === t.key ? "btn-primary" : ""}`} onClick={() => setProveedorTab(t.key)}>
          {t.label}
        </button>
      ))}
    </div>

    {/* Tab: Lista de proveedores */}
    {proveedorTab === "lista" && (
      <div className="grid-2">
        <div className="card">
          <h3>{editProveedorId ? "Editar proveedor" : "Agregar proveedor"}</h3>
          <form onSubmit={handleGuardarProveedor} className="form-grid">
            <input className="input" placeholder="Nombre *" value={formProveedor.nombre} onChange={e => setFormProveedor({ ...formProveedor, nombre: e.target.value })} />
            <input className="input" placeholder="Teléfono" value={formProveedor.telefono} onChange={e => setFormProveedor({ ...formProveedor, telefono: e.target.value })} />
            <input className="input" placeholder="RUC" value={formProveedor.ruc} onChange={e => setFormProveedor({ ...formProveedor, ruc: e.target.value })} />
            <input className="input" placeholder="Dirección" value={formProveedor.direccion} onChange={e => setFormProveedor({ ...formProveedor, direccion: e.target.value })} />
            <div className="form-actions">
              <button className="btn btn-primary" type="submit" disabled={loadingAction} style={{ flex: 1 }}>
                {loadingAction ? "Guardando..." : editProveedorId ? "Actualizar" : "Agregar proveedor"}
              </button>
              {editProveedorId && <button className="btn" type="button" onClick={() => { setEditProveedorId(null); setFormProveedor({ nombre: "", telefono: "", ruc: "", direccion: "" }); }}>Cancelar</button>}
            </div>
          </form>
        </div>
        <div className="card">
          <h3>Proveedores registrados ({proveedores.length})</h3>
          {proveedores.length === 0 ? <p className="note">No hay proveedores aún.</p> : (
            <div className="list-panel">
              {proveedores.map(p => (
                <div key={p.id} className="list-item">
                  <div style={{ width: 40, height: 40, borderRadius: 8, background: "#1a2e20", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}>🚚</div>
                  <div className="list-item-info">
                    <div className="list-item-name">{p.nombre}</div>
                    <div className="list-item-meta">
                      {p.telefono && `📞 ${p.telefono}`}
                      {p.ruc && ` · RUC: ${p.ruc}`}
                      {p.direccion && ` · ${p.direccion}`}
                    </div>
                  </div>
                  <div className="list-item-actions">
                    <button className="btn btn-xs" onClick={() => { setEditProveedorId(p.id); setFormProveedor({ nombre: p.nombre, telefono: p.telefono || "", ruc: p.ruc || "", direccion: p.direccion || "" }); }}>Editar</button>
                    <button className="btn btn-xs btn-danger" onClick={() => handleEliminarProveedor(p.id)}>Eliminar</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    )}

    {/* Tab: Registrar entrada */}
    {proveedorTab === "nueva-entrada" && (
       <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, alignItems: "start" }}>
        <div className="card">
          <h3>Registrar entrada de mercadería</h3>
          <form onSubmit={handleRegistrarEntrada} className="form-grid">
            <div>
              <label style={{ fontSize: 11, color: "#555", marginBottom: 4, display: "block" }}>Proveedor *</label>
              <select className="input" value={formEntrada.proveedorId} onChange={e => setFormEntrada({ ...formEntrada, proveedorId: e.target.value })}>
                <option value="">Selecciona un proveedor...</option>
                {proveedores.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 11, color: "#555", marginBottom: 4, display: "block" }}>Producto *</label>
              <select className="input" value={formEntrada.productoId} onChange={e => setFormEntrada({ ...formEntrada, productoId: e.target.value })}>
                <option value="">Selecciona un producto...</option>
                {productos.map(p => <option key={p.id} value={p.id}>{p.nombre} (stock: {p.stock})</option>)}
              </select>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <div>
                <label style={{ fontSize: 11, color: "#555", marginBottom: 4, display: "block" }}>Cantidad *</label>
                <input className="input" type="number" min="1" placeholder="0" value={formEntrada.cantidad} onChange={e => setFormEntrada({ ...formEntrada, cantidad: e.target.value })} />
              </div>
              <div>
                <label style={{ fontSize: 11, color: "#555", marginBottom: 4, display: "block" }}>Precio de costo (S/) *</label>
                <input className="input" type="number" min="0" step="0.01" placeholder="0.00" value={formEntrada.precioCompra} onChange={e => setFormEntrada({ ...formEntrada, precioCompra: e.target.value })} />
              </div>
            </div>
            {formEntrada.cantidad && formEntrada.precioCompra && (
              <div style={{ background: "#1a2e20", borderRadius: 8, padding: "10px 14px", display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontSize: 13, color: "#888" }}>Total a pagar</span>
                <strong style={{ color: "#39ff8f" }}>S/{(Number(formEntrada.cantidad) * Number(formEntrada.precioCompra)).toFixed(2)}</strong>
              </div>
            )}
            <input className="input" placeholder="Notas (opcional)" value={formEntrada.notas} onChange={e => setFormEntrada({ ...formEntrada, notas: e.target.value })} />
            <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", fontSize: 13 }}>
              <input type="checkbox" checked={formEntrada.pagado} onChange={e => setFormEntrada({ ...formEntrada, pagado: e.target.checked })} style={{ width: 16, height: 16 }} />
              <span style={{ color: "#888" }}>Marcar como pagado al registrar</span>
            </label>
            <button className="btn btn-primary" type="submit" disabled={loadingAction}>
              {loadingAction ? "Registrando..." : "📥 Registrar entrada y actualizar stock"}
            </button>
          </form>
        </div>
        <div className="card">
          <h3>Últimas entradas</h3>
          {entradas.length === 0 ? <p className="note">Sin entradas registradas.</p> : (
            <div className="list-panel">
              {entradas.slice(0, 15).map(e => (
                <div key={e.id} className="list-item">
                  <div className="list-item-info">
                    <div className="list-item-name">{e.productoNombre}</div>
                    <div className="list-item-meta">
                      {e.proveedorNombre} · {e.cantidad} unidades · S/{e.precioCompra?.toFixed(2)} c/u
                      {e.createdAt?.seconds && ` · ${new Date(e.createdAt.seconds * 1000).toLocaleDateString("es-PE")}`}
                    </div>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#39ff8f" }}>S/{e.total?.toFixed(2)}</div>
                    <span className={`badge ${e.pagado ? "badge-green" : "badge-red"}`}>{e.pagado ? "Pagado" : "Pendiente"}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    )}

    {/* Tab: Deudas */}
    {proveedorTab === "deudas" && (
      <>
        {/* Resumen por proveedor */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 8 }}>
  {proveedores.map(prov => {
    const entradasProv = entradas.filter(e => e.proveedorId === prov.id && !e.pagado);
    const totalDeuda = entradasProv.reduce((acc, e) => acc + Number(e.total || 0), 0);
    if (totalDeuda === 0) return null;
    return (
      <div key={prov.id} style={{
        background: "#111118", border: "1px solid #ff4d4d44",
        borderLeft: "3px solid #ff6b6b", borderRadius: 10,
        padding: "12px 16px", display: "flex",
        justifyContent: "space-between", alignItems: "center",
      }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#f0ede8" }}>{prov.nombre}</div>
          <div style={{ fontSize: 11, color: "#555", marginTop: 2 }}>
            {entradasProv.length} entrada{entradasProv.length !== 1 ? "s" : ""} pendiente{entradasProv.length !== 1 ? "s" : ""}
          </div>
        </div>
        <div style={{ fontSize: 20, fontWeight: 700, color: "#ff6b6b" }}>
          S/{totalDeuda.toFixed(2)}
        </div>
      </div>
    );
  }).filter(Boolean)}
  {proveedores.every(prov => entradas.filter(e => e.proveedorId === prov.id && !e.pagado).reduce((acc, e) => acc + Number(e.total || 0), 0) === 0) && (
    <p className="note">🎉 No tienes deudas pendientes con proveedores.</p>
  )}
</div>
        {/* Historial de pagados */}
        <div className="card">
          <h3>Historial de pagos realizados</h3>
          {entradas.filter(e => e.pagado).length === 0 ? <p className="note">Sin pagos registrados.</p> : (
            <div className="list-panel">
              {entradas.filter(e => e.pagado).map(e => (
                <div key={e.id} className="list-item">
                  <div className="list-item-info">
                    <div className="list-item-name">{e.productoNombre} x{e.cantidad}</div>
                    <div className="list-item-meta">{e.proveedorNombre} · {e.createdAt?.seconds ? new Date(e.createdAt.seconds * 1000).toLocaleDateString("es-PE") : ""}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#39ff8f" }}>S/{Number(e.total).toFixed(2)}</div>
                    <button className="btn btn-xs" onClick={() => handleMarcarPagado(e.id, e.pagado)} style={{ marginTop: 4, fontSize: 10 }}>Marcar pendiente</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </>
    )}
  </>
)}

      {showQR && (
        <div className="modal-overlay" onClick={() => setShowQR(false)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <p style={{ fontWeight: 700, fontSize: 16, marginBottom: 8, color: "#f0ede8" }}>Escáner remoto</p>
            <p style={{ fontSize: 13, color: "#555", marginBottom: 16 }}>Escanea con tu celular para abrir la cámara</p>
            <div style={{ background: "#fff", padding: 16, borderRadius: 12, display: "inline-block" }}>
              <QRCode value={`${window.location.origin}/scanner/${sessionId}`} size={160} />
            </div>
            <p style={{ fontSize: 11, color: "#444", marginTop: 12 }}>Sesión: {sessionId}</p>
            <button className="btn" style={{ width: "100%", marginTop: 16 }} onClick={() => setShowQR(false)}>Cerrar</button>
          </div>
        </div>
      )}

      {toast && <Toast msg={toast.msg} type={toast.type} />}
    </div>
  );
}