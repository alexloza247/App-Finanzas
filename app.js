// Control de Finanzas — versión independiente
// Los datos se guardan solo en el navegador (localStorage).
"use strict";

var STORAGE_KEY = "controlFinanzasV1";

var CATEGORIES = [
  "Comida", "Transporte", "Súper y despensa", "Vivienda", "Servicios",
  "Salud", "Entretenimiento", "Ropa", "Educación", "Mascotas",
  "Compras", "Sueldo", "Otro ingreso", "Otro"
];

var state = loadState();
var editingAccountId = null;
var editingTxId = null;
var today = new Date();
var viewYear = today.getFullYear();
var viewMonth = today.getMonth();

function loadState() {
  try {
    var raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { accounts: [], transactions: [] };
    var parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.accounts) || !Array.isArray(parsed.transactions)) {
      return { accounts: [], transactions: [] };
    }
    return parsed;
  } catch (e) {
    return { accounts: [], transactions: [] };
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function uid() {
  return "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
}

function fmt(amount) {
  return new Intl.NumberFormat("es-MX", {
    style: "currency", currency: "MXN"
  }).format(amount || 0);
}

function escapeHtml(text) {
  return String(text == null ? "" : text)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function $(id) { return document.getElementById(id); }

function accountById(id) {
  return state.accounts.find(function (a) { return a.id === id; });
}

function typeLabel(type) {
  if (type === "ingreso") return "Ingreso";
  if (type === "gasto") return "Gasto";
  if (type === "transferencia") return "Transferencia";
  if (type === "pago") return "Pago de tarjeta";
  return type;
}

// "Súper" era el nombre anterior de la categoría; hoy es "Súper y despensa".
function displayCategory(cat) {
  if (cat === "Súper") return "Súper y despensa";
  return cat || "Otro";
}

function monthKey() {
  return viewYear + "-" + String(viewMonth + 1).padStart(2, "0");
}

function monthLabel() {
  var label = new Intl.DateTimeFormat("es-MX", { month: "long", year: "numeric" })
    .format(new Date(viewYear, viewMonth, 1));
  return label.charAt(0).toUpperCase() + label.slice(1);
}

// ---- Meses sin intereses (MSI) ----
// La deuda total se suma a la tarjeta al comprar; el resumen mensual
// solo cuenta la mensualidad que toca ese mes.
function round2(n) { return Math.round(n * 100) / 100; }

function msiMonths(tx) {
  var m = parseInt(tx && tx.months, 10);
  return m > 1 ? m : 1;
}

function msiMonthly(tx) {
  if (tx && tx.monthlyAmount) return tx.monthlyAmount;
  return round2((tx.amount || 0) / msiMonths(tx));
}

// Meses transcurridos entre el mes de inicio ("YYYY-MM") y otro mes.
function monthsBetween(startDate, year, month) {
  var y = parseInt(startDate.slice(0, 4), 10);
  var m = parseInt(startDate.slice(5, 7), 10) - 1;
  return (year - y) * 12 + (month - m);
}

// Monto de la mensualidad número idx (0-based) de un gasto MSI.
// La última mensualidad absorbe el redondeo para que la suma sea el total.
function msiInstallmentAmount(tx, idx) {
  var months = msiMonths(tx);
  if (months <= 1) return tx.amount;
  var monthly = msiMonthly(tx);
  if (idx === months - 1) return round2(tx.amount - monthly * (months - 1));
  return monthly;
}

// Mensualidad que toca en el mes de vista (viewYear/viewMonth), o 0 si no toca.
function msiAmountForViewMonth(tx) {
  if (tx.type !== "gasto") return 0;
  var idx = monthsBetween(tx.date, viewYear, viewMonth);
  if (idx < 0 || idx >= msiMonths(tx)) return 0;
  return msiInstallmentAmount(tx, idx);
}

function msiInstallmentLabel(tx) {
  var months = msiMonths(tx);
  if (months <= 1) return "";
  var idx = monthsBetween(tx.date, viewYear, viewMonth);
  var base = "a " + months + " MSI · " + fmt(msiMonthly(tx)) + "/mes";
  if (idx >= 0 && idx < months) return base + " · " + (idx + 1) + "/" + months;
  if (idx < 0) return base + " · inicia " + tx.date.slice(0, 7);
  return base + " · " + months + "/" + months + " pagado";
}

// En efectivo/débito, "balance" es el saldo.
// En crédito, "balance" es la deuda actual.
function addFunds(account, amount) {
  if (!account) return;
  if (account.type === "credito") account.balance -= amount;
  else account.balance += amount;
}

function spend(account, amount) {
  if (!account) return;
  if (account.type === "credito") account.balance += amount;
  else account.balance -= amount;
}

function applyTx(tx, sign) {
  var amount = tx.amount * sign;
  var from = accountById(tx.accountId);
  var to = tx.destinationId ? accountById(tx.destinationId) : null;
  if (tx.type === "ingreso") addFunds(from, amount);
  else if (tx.type === "gasto") spend(from, amount);
  else if (tx.type === "transferencia" || tx.type === "pago") {
    spend(from, amount);
    addFunds(to, amount);
  }
}

function totals() {
  var cashDebit = 0, creditDebt = 0, creditAvailable = 0, creditLimit = 0;
  state.accounts.forEach(function (a) {
    if (a.type === "credito") {
      creditDebt += a.balance;
      creditLimit += a.limit || 0;
      creditAvailable += Math.max(0, (a.limit || 0) - a.balance);
    } else {
      cashDebit += a.balance;
    }
  });
  return {
    cashDebit: cashDebit,
    creditDebt: creditDebt,
    creditAvailable: creditAvailable,
    creditLimit: creditLimit,
    netWorth: cashDebit - creditDebt
  };
}

function setTab(name) {
  document.querySelectorAll(".tab").forEach(function (btn) {
    btn.classList.toggle("active", btn.getAttribute("data-tab") === name);
  });
  ["resumen", "cuentas", "movimientos"].forEach(function (n) {
    $("panel-" + n).hidden = n !== name;
  });
}

function openModal(id) { $(id).hidden = false; }
function closeModal(id) { $(id).hidden = true; }
function closeAllModals() {
  ["accountModal", "txModal"].forEach(function (id) { $(id).hidden = true; });
}

function msiPlansHtml(cardId) {
  var now = new Date();
  var plans = state.transactions.filter(function (tx) {
    if (tx.type !== "gasto" || tx.accountId !== cardId || msiMonths(tx) <= 1) return false;
    var paid = Math.min(msiMonths(tx), Math.max(0, monthsBetween(tx.date, now.getFullYear(), now.getMonth())));
    return paid < msiMonths(tx);
  });
  if (!plans.length) return "";
  return '<div class="msi-plans"><p class="msi-title">Planes a meses sin intereses</p>' + plans.map(function (tx) {
    var months = msiMonths(tx);
    var paid = Math.min(months, Math.max(0, monthsBetween(tx.date, now.getFullYear(), now.getMonth())));
    var remaining = months - paid;
    var paidSum = 0;
    for (var i = 0; i < paid; i++) paidSum += msiInstallmentAmount(tx, i);
    var remainingTotal = round2(tx.amount - paidSum);
    return '<p class="meta msi-plan">' + escapeHtml(tx.note || displayCategory(tx.category)) +
      " · " + fmt(tx.amount) + " a " + months + " MSI · " + fmt(msiMonthly(tx)) + "/mes" +
      " · pagados " + paid + " de " + months + " · faltan " + remaining +
      " · restante: " + fmt(remainingTotal) + "</p>";
  }).join("") + "</div>";
}

function renderAccounts() {
  var list = $("accountsList");
  var t = totals();
  $("netWorth").textContent = fmt(t.netWorth);
  $("totalCashDebit").textContent = fmt(t.cashDebit);
  $("totalCreditDebt").textContent = fmt(t.creditDebt);
  $("totalCreditAvailable").textContent = fmt(t.creditAvailable);
  $("noAccounts").hidden = state.accounts.length > 0;

  list.innerHTML = state.accounts.map(function (a) {
    var creditHtml = "";
    if (a.type === "credito") {
      var limit = a.limit || 0;
      var usedPct = limit > 0 ? Math.min(100, Math.max(0, (a.balance / limit) * 100)) : 0;
      var available = Math.max(0, limit - a.balance);
      creditHtml =
        '<p class="meta">Límite: ' + fmt(limit) +
        ' · Disponible: ' + fmt(available) +
        (a.last4 ? ' · •••• ' + escapeHtml(a.last4) : "") +
        (a.cutoffDay ? ' · Corte: día ' + a.cutoffDay : "") +
        (a.paymentDay ? ' · Pago: día ' + a.paymentDay : "") + "</p>" +
        '<div class="usage' + (usedPct >= 90 ? " over" : "") + '">' +
        '<span style="width:' + usedPct.toFixed(1) + '%"></span></div>' +
        '<p class="meta">Uso del crédito: ' + usedPct.toFixed(0) + "%</p>" +
        msiPlansHtml(a.id) +
        '<div class="account-actions">' +
        '<button type="button" class="btn small pay" data-pay="' + a.id + '">Pagar tarjeta</button>' +
        "</div>";
    }
    return '<article class="account">' +
      "<header><h4>" + escapeHtml(a.name) + '</h4><span class="badge' + (a.type === "credito" ? " credit" : "") + '">' + escapeHtml(a.type) + "</span></header>" +
      '<p class="amount mono">' + fmt(a.balance) + "</p>" +
      '<p class="meta">' + (a.type === "credito" ? "Deuda actual" : "Saldo actual") + "</p>" +
      creditHtml +
      '<div class="account-actions">' +
      '<button type="button" class="btn small" data-edit-account="' + a.id + '">Editar</button>' +
      '<button type="button" class="btn small danger" data-delete-account="' + a.id + '">Eliminar</button>' +
      "</div></article>";
  }).join("");

  list.querySelectorAll("[data-edit-account]").forEach(function (btn) {
    btn.addEventListener("click", function () { startEditAccount(btn.getAttribute("data-edit-account")); });
  });
  list.querySelectorAll("[data-delete-account]").forEach(function (btn) {
    btn.addEventListener("click", function () { deleteAccount(btn.getAttribute("data-delete-account")); });
  });
  list.querySelectorAll("[data-pay]").forEach(function (btn) {
    btn.addEventListener("click", function () { startPayCard(btn.getAttribute("data-pay")); });
  });
}

function fillAccountSelects() {
  var txAccount = $("txAccount");
  var txDestination = $("txDestination");
  var filterAccount = $("filterAccount");
  var currentFilter = filterAccount.value;

  txAccount.innerHTML = state.accounts.map(function (a) {
    return '<option value="' + a.id + '">' + escapeHtml(a.name) + " (" + escapeHtml(a.type) + ")</option>";
  }).join("");
  txDestination.innerHTML = state.accounts.map(function (a) {
    return '<option value="' + a.id + '">' + escapeHtml(a.name) + " (" + escapeHtml(a.type) + ")</option>";
  }).join("");
  filterAccount.innerHTML = '<option value="">Todas</option>' + state.accounts.map(function (a) {
    return '<option value="' + a.id + '">' + escapeHtml(a.name) + "</option>";
  }).join("");
  if (state.accounts.some(function (a) { return a.id === currentFilter; })) {
    filterAccount.value = currentFilter;
  }
}

function renderSummary() {
  var month = monthKey();
  $("monthLabel").textContent = monthLabel();
  var income = 0, expense = 0;
  var byCategory = {};
  state.transactions.forEach(function (tx) {
    if (tx.type === "ingreso" && tx.date.slice(0, 7) === month) income += tx.amount;
    if (tx.type === "gasto") {
      var due = msiAmountForViewMonth(tx);
      if (due > 0) {
        expense += due;
        var cat = displayCategory(tx.category);
        byCategory[cat] = (byCategory[cat] || 0) + due;
      }
    }
  });
  $("monthIncome").textContent = fmt(income);
  $("monthExpense").textContent = fmt(expense);
  $("monthBalance").textContent = fmt(income - expense);

  var entries = Object.entries(byCategory).sort(function (a, b) { return b[1] - a[1]; });
  var max = entries.length ? entries[0][1] : 0;
  $("noCategory").hidden = entries.length > 0;
  $("categorySummary").innerHTML = entries.map(function (entry) {
    var pct = max > 0 ? (entry[1] / max) * 100 : 0;
    return '<div class="category-row"><span>' + escapeHtml(entry[0]) + "</span><strong class=\"mono\">" + fmt(entry[1]) + "</strong>" +
      '<div class="bar"><span style="width:' + pct.toFixed(1) + '%"></span></div></div>';
  }).join("");
}

function txItemHtml(tx) {
  var from = accountById(tx.accountId);
  var to = tx.destinationId ? accountById(tx.destinationId) : null;
  var detail = from ? from.name : "Cuenta eliminada";
  if (to) detail += " → " + to.name;
  var isIncome = tx.type === "ingreso";
  var sign = isIncome ? "+" : "−";
  var cls = isIncome ? "income" : (tx.type === "gasto" ? "expense" : "");
  return '<li><div><div class="tx-title">' + escapeHtml(tx.note || typeLabel(tx.type)) + "</div>" +
    '<div class="tx-meta">' + escapeHtml(typeLabel(tx.type)) + " · " + escapeHtml(detail) +
    " · " + escapeHtml(tx.date) +
    (tx.category && tx.type === "gasto" ? " · " + escapeHtml(displayCategory(tx.category)) : "") +
    (tx.type === "gasto" && msiMonths(tx) > 1 ? " · " + escapeHtml(msiInstallmentLabel(tx)) : "") + "</div></div>" +
    '<div class="tx-amount mono ' + cls + '">' + sign + " " + fmt(tx.amount) + "</div>" +
    '<div class="tx-actions">' +
    '<button type="button" class="btn small" data-edit-tx="' + tx.id + '">Editar</button>' +
    '<button type="button" class="btn small danger" data-delete-tx="' + tx.id + '">Eliminar</button>' +
    "</div></li>";
}

function bindTxButtons(root) {
  root.querySelectorAll("[data-edit-tx]").forEach(function (btn) {
    btn.addEventListener("click", function () { startEditTx(btn.getAttribute("data-edit-tx")); });
  });
  root.querySelectorAll("[data-delete-tx]").forEach(function (btn) {
    btn.addEventListener("click", function () { deleteTx(btn.getAttribute("data-delete-tx")); });
  });
}

function sortedTransactions() {
  return state.transactions.slice().sort(function (a, b) {
    if (a.date !== b.date) return b.date.localeCompare(a.date);
    return 0;
  });
}

function filteredTransactions() {
  var accountId = $("filterAccount").value;
  var type = $("filterType").value;
  var search = $("filterSearch").value.trim().toLowerCase();
  return sortedTransactions().filter(function (tx) {
    if (accountId && tx.accountId !== accountId && tx.destinationId !== accountId) return false;
    if (type && tx.type !== type) return false;
    if (search && !(tx.note || "").toLowerCase().includes(search)) return false;
    return true;
  });
}

function renderTransactions() {
  var list = filteredTransactions();
  $("noTransactions").hidden = list.length > 0;
  $("transactionsList").innerHTML = list.map(txItemHtml).join("");
  bindTxButtons($("transactionsList"));

  var recent = sortedTransactions().slice(0, 5);
  $("noRecent").hidden = recent.length > 0;
  $("recentList").innerHTML = recent.map(txItemHtml).join("");
  bindTxButtons($("recentList"));
}

function renderAll() {
  fillAccountSelects();
  renderAccounts();
  renderSummary();
  renderTransactions();
  updateTxFormVisibility();
}

// ---- Cuentas ----

function startEditAccount(id) {
  var a = accountById(id);
  if (!a) return;
  editingAccountId = id;
  $("accountFormTitle").textContent = "Editar cuenta";
  $("accountName").value = a.name;
  $("accountType").value = a.type;
  $("accountType").disabled = true;
  $("balanceLabel").firstChild.textContent = a.type === "credito" ? "Deuda actual (MXN) " : "Saldo actual (MXN) ";
  $("accountBalance").value = a.balance;
  $("creditFields").hidden = a.type !== "credito";
  $("accountLimit").value = a.limit || 0;
  $("accountLast4").value = a.last4 || "";
  $("accountCutoff").value = a.cutoffDay || "";
  $("accountPaymentDay").value = a.paymentDay || "";
  $("accountSubmitBtn").textContent = "Guardar cambios";
  $("accountCancelBtn").hidden = false;
  openModal("accountModal");
}

function resetAccountForm() {
  editingAccountId = null;
  $("accountForm").reset();
  $("accountType").disabled = false;
  $("accountFormTitle").textContent = "Agregar cuenta";
  $("balanceLabel").firstChild.textContent = "Saldo actual (MXN) ";
  $("accountBalance").value = 0;
  $("creditFields").hidden = true;
  $("accountSubmitBtn").textContent = "Guardar cuenta";
  $("accountCancelBtn").hidden = true;
}

function deleteAccount(id) {
  var a = accountById(id);
  if (!a) return;
  var used = state.transactions.some(function (tx) {
    return tx.accountId === id || tx.destinationId === id;
  });
  if (used) {
    alert("No se puede eliminar: esta cuenta tiene movimientos registrados. Elimina primero esos movimientos.");
    return;
  }
  if (!confirm("¿Eliminar la cuenta «" + a.name + "»?")) return;
  state.accounts = state.accounts.filter(function (x) { return x.id !== id; });
  saveState();
  renderAll();
}

$("accountType").addEventListener("change", function () {
  var isCredit = $("accountType").value === "credito";
  $("creditFields").hidden = !isCredit;
  $("balanceLabel").firstChild.textContent = isCredit ? "Deuda actual (MXN) " : "Saldo actual (MXN) ";
});

$("accountForm").addEventListener("submit", function (e) {
  e.preventDefault();
  var type = $("accountType").value;
  var isCredit = type === "credito";
  var data = {
    name: $("accountName").value.trim(),
    type: type,
    balance: parseFloat($("accountBalance").value) || 0,
    limit: isCredit ? (parseFloat($("accountLimit").value) || 0) : 0,
    last4: isCredit ? $("accountLast4").value.trim() : "",
    cutoffDay: isCredit ? (parseInt($("accountCutoff").value, 10) || null) : null,
    paymentDay: isCredit ? (parseInt($("accountPaymentDay").value, 10) || null) : null
  };
  if (!data.name) return;
  if (editingAccountId) {
    var a = accountById(editingAccountId);
    if (a) Object.assign(a, data);
  } else {
    data.id = uid();
    state.accounts.push(data);
  }
  saveState();
  resetAccountForm();
  closeModal("accountModal");
  renderAll();
});

$("accountCancelBtn").addEventListener("click", function () {
  resetAccountForm();
  closeModal("accountModal");
});

$("addAccountBtn").addEventListener("click", function () {
  resetAccountForm();
  openModal("accountModal");
});

// ---- Movimientos ----

function updateMsiHint() {
  var hint = $("txMonthlyHint");
  if (!hint) return;
  var amount = parseFloat($("txAmount").value) || 0;
  var months = parseInt($("txMonths").value, 10) || 1;
  hint.textContent = amount > 0
    ? "Pago mensual: " + fmt(round2(amount / months)) + (months > 1 ? " durante " + months + " meses" : "")
    : "";
}

function updateTxFormVisibility() {
  var type = $("txType").value;
  var needsDestination = type === "transferencia" || type === "pago";
  $("txDestinationWrap").hidden = !needsDestination;
  $("txCategoryWrap").hidden = type !== "gasto";
  var account = accountById($("txAccount").value);
  $("txMsiWrap").hidden = !(type === "gasto" && account && account.type === "credito");
  updateMsiHint();
  if (type === "pago") {
    var creditOptions = state.accounts.filter(function (a) { return a.type === "credito"; });
    $("txDestination").innerHTML = creditOptions.map(function (a) {
      return '<option value="' + a.id + '">' + escapeHtml(a.name) + "</option>";
    }).join("");
    if (!creditOptions.length) {
      $("txDestination").innerHTML = "<option value=\"\">Primero agrega una tarjeta de crédito</option>";
    }
  } else if (type === "transferencia") {
    $("txDestination").innerHTML = state.accounts.map(function (a) {
      return '<option value="' + a.id + '">' + escapeHtml(a.name) + " (" + escapeHtml(a.type) + ")</option>";
    }).join("");
  }
}

$("txType").addEventListener("change", updateTxFormVisibility);
$("txAccount").addEventListener("change", updateTxFormVisibility);
$("txAmount").addEventListener("input", updateMsiHint);
$("txMonths").addEventListener("change", updateMsiHint);

function startPayCard(cardId) {
  var card = accountById(cardId);
  if (!card) return;
  resetTxForm();
  $("txType").value = "pago";
  updateTxFormVisibility();
  $("txDestination").value = cardId;
  $("txAmount").value = "";
  $("txDate").value = new Date().toISOString().slice(0, 10);
  openModal("txModal");
  $("txAmount").focus();
}

function startEditTx(id) {
  var tx = state.transactions.find(function (t) { return t.id === id; });
  if (!tx) return;
  editingTxId = id;
  $("txFormTitle").textContent = "Editar movimiento";
  $("txType").value = tx.type;
  updateTxFormVisibility();
  $("txAccount").value = tx.accountId;
  if (tx.destinationId) $("txDestination").value = tx.destinationId;
  $("txAmount").value = tx.amount;
  $("txDate").value = tx.date;
  $("txMonths").value = String(msiMonths(tx));
  $("txCategory").value = displayCategory(tx.category);
  $("txNote").value = tx.note || "";
  updateTxFormVisibility();
  $("txSubmitBtn").textContent = "Guardar cambios";
  $("txCancelBtn").hidden = false;
  openModal("txModal");
}

function resetTxForm() {
  editingTxId = null;
  $("transactionForm").reset();
  $("txMonths").value = "1";
  $("txFormTitle").textContent = "Registrar movimiento";
  $("txDate").value = new Date().toISOString().slice(0, 10);
  $("txSubmitBtn").textContent = "Guardar movimiento";
  $("txCancelBtn").hidden = true;
  updateTxFormVisibility();
}

$("txCancelBtn").addEventListener("click", function () {
  resetTxForm();
  closeModal("txModal");
});

$("registerMovementBtn").addEventListener("click", function () {
  resetTxForm();
  openModal("txModal");
});

$("transactionForm").addEventListener("submit", function (e) {
  e.preventDefault();
  if (!state.accounts.length) {
    alert("Primero agrega una cuenta.");
    return;
  }
  var type = $("txType").value;
  var amount = parseFloat($("txAmount").value) || 0;
  var account = accountById($("txAccount").value);
  var msi = type === "gasto" && account && account.type === "credito"
    ? (parseInt($("txMonths").value, 10) || 1) : 1;
  var tx = {
    id: editingTxId || uid(),
    type: type,
    accountId: $("txAccount").value,
    destinationId: (type === "transferencia" || type === "pago") ? $("txDestination").value : null,
    amount: amount,
    date: $("txDate").value,
    category: type === "gasto" ? $("txCategory").value : "",
    note: $("txNote").value.trim(),
    months: msi,
    monthlyAmount: round2(amount / msi)
  };
  if (!tx.accountId || !tx.amount || tx.amount <= 0 || !tx.date) return;
  if ((type === "transferencia" || type === "pago") && (!tx.destinationId || tx.destinationId === tx.accountId)) {
    alert("Elige una cuenta destino diferente a la cuenta de origen.");
    return;
  }
  if (type === "pago" && accountById(tx.destinationId).type !== "credito") {
    alert("El destino de un pago debe ser una tarjeta de crédito.");
    return;
  }
  if (editingTxId) {
    var old = state.transactions.find(function (t) { return t.id === editingTxId; });
    if (old) applyTx(old, -1);
    Object.assign(old, tx);
    applyTx(old, 1);
  } else {
    state.transactions.push(tx);
    applyTx(tx, 1);
  }
  saveState();
  resetTxForm();
  closeModal("txModal");
  renderAll();
});

function deleteTx(id) {
  var tx = state.transactions.find(function (t) { return t.id === id; });
  if (!tx) return;
  if (!confirm("¿Eliminar este movimiento?")) return;
  applyTx(tx, -1);
  state.transactions = state.transactions.filter(function (t) { return t.id !== id; });
  saveState();
  renderAll();
}

// ---- Pestañas, mes y modales ----

document.querySelectorAll(".tab").forEach(function (btn) {
  btn.addEventListener("click", function () { setTab(btn.getAttribute("data-tab")); });
});

$("prevMonth").addEventListener("click", function () {
  viewMonth -= 1;
  if (viewMonth < 0) { viewMonth = 11; viewYear -= 1; }
  renderSummary();
});

$("nextMonth").addEventListener("click", function () {
  viewMonth += 1;
  if (viewMonth > 11) { viewMonth = 0; viewYear += 1; }
  renderSummary();
});

document.querySelectorAll("[data-close]").forEach(function (btn) {
  btn.addEventListener("click", function () { closeModal(btn.getAttribute("data-close")); });
});

document.querySelectorAll(".modal").forEach(function (modal) {
  modal.addEventListener("click", function (e) {
    if (e.target === modal) closeModal(modal.id);
  });
});

document.addEventListener("keydown", function (e) {
  if (e.key === "Escape") closeAllModals();
});

// ---- Filtros ----

$("filterAccount").addEventListener("change", renderTransactions);
$("filterType").addEventListener("change", renderTransactions);
$("filterSearch").addEventListener("input", renderTransactions);

// ---- Inicio ----

(function init() {
  $("txDate").value = today.toISOString().slice(0, 10);
  setTab("resumen");
  renderAll();
})();
