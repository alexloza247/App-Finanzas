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
    if (tx.date.slice(0, 7) !== month) return;
    if (tx.type === "ingreso") income += tx.amount;
    if (tx.type === "gasto") {
      expense += tx.amount;
      var cat = displayCategory(tx.category);
      byCategory[cat] = (byCategory[cat] || 0) + tx.amount;
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
    (tx.category && tx.type === "gasto" ? " · " + escapeHtml(displayCategory(tx.category)) : "") + "</div></div>" +
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

function updateTxFormVisibility() {
  var type = $("txType").value;
  var needsDestination = type === "transferencia" || type === "pago";
  $("txDestinationWrap").hidden = !needsDestination;
  $("txCategoryWrap").hidden = type !== "gasto";
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
  $("txCategory").value = displayCategory(tx.category);
  $("txNote").value = tx.note || "";
  $("txSubmitBtn").textContent = "Guardar cambios";
  $("txCancelBtn").hidden = false;
  openModal("txModal");
}

function resetTxForm() {
  editingTxId = null;
  $("transactionForm").reset();
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
  var tx = {
    id: editingTxId || uid(),
    type: type,
    accountId: $("txAccount").value,
    destinationId: (type === "transferencia" || type === "pago") ? $("txDestination").value : null,
    amount: parseFloat($("txAmount").value) || 0,
    date: $("txDate").value,
    category: type === "gasto" ? $("txCategory").value : "",
    note: $("txNote").value.trim()
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
