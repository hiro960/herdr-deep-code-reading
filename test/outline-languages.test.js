"use strict";

// The languages added after the first set: what each one declares, and what it
// reaches for. Heuristics, like every other language here — what matters is that a
// reader is offered somewhere to jump rather than told the file declares nothing.

const test = require("node:test");
const assert = require("node:assert");

const { buildImports, buildOutline, definesName, hasOutline } = require("../lib/outline");
const { detectLanguage } = require("../lib/syntax");

/** Names only, which is what the outline is read for. */
function namesOf(lines, language) {
  return buildOutline(lines, language, "f").map((entry) => entry.name);
}

/** The specifiers a file reaches for, by the name each is recorded under. */
function importsOf(lines, filePath) {
  return buildImports(lines, filePath).map((entry) => entry.name);
}

// --- which files reach which language ----------------------------------------

test("the new extensions name their languages", () => {
  const expected = {
    "a.lua": "lua",
    "a.swift": "swift",
    "a.kt": "kotlin",
    "a.kts": "kotlin",
    "a.php": "php",
    "a.cs": "csharp",
    "a.sql": "sql",
    "a.html": "html",
    "a.htm": "html",
    "a.css": "css",
    "a.scss": "css",
    "a.less": "css",
    "a.vue": "vue",
  };

  for (const [path, language] of Object.entries(expected)) {
    assert.strictEqual(detectLanguage(path), language, path);
  }
});

test("every one of them has an outline to offer", () => {
  for (const language of ["lua", "swift", "kotlin", "php", "csharp", "sql", "html", "css", "vue"]) {
    assert.strictEqual(hasOutline(language), true, language);
  }
});

// --- Lua ---------------------------------------------------------------------

test("Lua: functions, methods and tables", () => {
  const lines = [
    "local M = {}",
    "local function helper(a)",
    "function M.setup(opts)",
    "function Panel:render()",
    "M.close = function()",
  ];

  assert.deepStrictEqual(namesOf(lines, "lua"), ["M", "helper", "M.setup", "Panel:render", "M.close"]);
});

test("Lua: a require is what the file reaches for, not what it declares", () => {
  const lines = ['local config = require("diffview.config")', "local x = 1"];

  assert.deepStrictEqual(namesOf(lines, "lua"), ["x"]);
  assert.deepStrictEqual(importsOf(lines, "a.lua"), ["diffview.config"]);
});

test("Lua: a require without brackets is still a require", () => {
  assert.deepStrictEqual(importsOf(['local m = require "diffview.utils"'], "a.lua"), [
    "diffview.utils",
  ]);
});

// --- Swift -------------------------------------------------------------------

test("Swift: types, functions and properties", () => {
  const lines = [
    "struct ContentView: View {",
    "final class Store {",
    "protocol Loading {",
    "extension Store {",
    "func greet(name: String) -> String {",
    "public static func make() -> Store {",
    "let shared = Store()",
    "typealias Handler = (Int) -> Void",
  ];

  assert.deepStrictEqual(namesOf(lines, "swift"), [
    "ContentView",
    "Store",
    "Loading",
    "Store",
    "greet",
    "make",
    "shared",
    "Handler",
  ]);
});

test("Swift: a class function is a function, not a type called func", () => {
  assert.deepStrictEqual(namesOf(["class func make() -> Self {"], "swift"), ["make"]);
});

test("Swift: a method of a type, indented as Swift indents it", () => {
  assert.deepStrictEqual(namesOf(["    private func reload() {"], "swift"), ["reload"]);
});

// --- Kotlin ------------------------------------------------------------------

test("Kotlin: classes, objects, functions and properties", () => {
  const lines = [
    "class Store(private val api: Api) {",
    "data class User(val id: String)",
    "sealed interface State {",
    "enum class Mode {",
    "object Registry {",
    "fun load(id: String): User {",
    "suspend fun refresh() {",
    "val shared = Store()",
    "typealias Handler = (Int) -> Unit",
  ];

  assert.deepStrictEqual(namesOf(lines, "kotlin"), [
    "Store",
    "User",
    "State",
    "Mode",
    "Registry",
    "load",
    "refresh",
    "shared",
    "Handler",
  ]);
});

test("Kotlin: an extension function is named by the function, not the receiver", () => {
  assert.deepStrictEqual(namesOf(["fun String.slugify(): String {"], "kotlin"), ["slugify"]);
});

test("Kotlin: a method of a class, indented as Kotlin indents it", () => {
  assert.deepStrictEqual(namesOf(["    override fun render() {"], "kotlin"), ["render"]);
});

// --- PHP ---------------------------------------------------------------------

test("PHP: namespaces, classes, methods and constants", () => {
  const lines = [
    "namespace App\\Models;",
    "final class User extends Model",
    "interface Nameable",
    "trait HasRoles",
    "function helper(array $args)",
    "    public function save(): bool",
    "const MAX = 10;",
  ];

  assert.deepStrictEqual(namesOf(lines, "php"), [
    "App\\Models",
    "User",
    "Nameable",
    "HasRoles",
    "helper",
    "save",
    "MAX",
  ]);
});

test("PHP: a use statement is what the file reaches for", () => {
  const lines = ["use App\\Models\\User;", "class Controller"];

  assert.deepStrictEqual(namesOf(lines, "php"), ["Controller"]);
});

// --- C# ----------------------------------------------------------------------

test("C#: namespaces, types and members", () => {
  const lines = [
    "namespace Tominagadenki.Orders",
    "public sealed class OrderService : IOrderService",
    "internal interface IOrderService",
    "public record struct Money(decimal Amount)",
    "    public async Task<Order> LoadAsync(int id)",
    "    public string Name { get; set; }",
  ];

  assert.deepStrictEqual(namesOf(lines, "csharp"), [
    "Tominagadenki.Orders",
    "OrderService",
    "IOrderService",
    "Money",
    "LoadAsync",
    "Name",
  ]);
});

test("C#: a control statement is not a member", () => {
  assert.deepStrictEqual(namesOf(["    if (ready)", "    return new Order();"], "csharp"), []);
});

test("C#: a using is what the file reaches for", () => {
  assert.deepStrictEqual(namesOf(["using System.Text;", "class A"], "csharp"), ["A"]);
});

// --- SQL ---------------------------------------------------------------------

test("SQL: what a script creates, whatever case it shouts it in", () => {
  const lines = [
    "CREATE TABLE orders (",
    "create or replace view active_orders as",
    "CREATE UNIQUE INDEX orders_pkey ON orders (id);",
    "CREATE OR REPLACE FUNCTION total(order_id int) RETURNS numeric AS $$",
    "ALTER TABLE orders ADD COLUMN paid boolean;",
  ];

  assert.deepStrictEqual(namesOf(lines, "sql"), [
    "orders",
    "active_orders",
    "orders_pkey",
    "total",
    "orders",
  ]);
});

// --- HTML --------------------------------------------------------------------

test("HTML: headings and the things that carry an id", () => {
  const lines = ["<h1>Order list</h1>", '<section id="summary">', '<div class="row">'];

  assert.deepStrictEqual(namesOf(lines, "html"), ["Order list", "summary"]);
});

test("HTML: what a page pulls in", () => {
  const lines = ['<script src="./app.js"></script>', '<link rel="stylesheet" href="./site.css">'];

  assert.deepStrictEqual(importsOf(lines, "a.html"), ["./app.js", "./site.css"]);
});

// --- CSS ---------------------------------------------------------------------

test("CSS: selectors, at-rules and variables", () => {
  const lines = [
    "$brand: #f00;",
    "--radius: 4px;",
    ".card > .title {",
    "@media (min-width: 40em) {",
    "  color: red;",
  ];

  assert.deepStrictEqual(namesOf(lines, "css"), ["$brand", "--radius", ".card > .title", "@media (min-width: 40em)"]);
});

test("CSS: what a stylesheet pulls in", () => {
  assert.deepStrictEqual(importsOf(['@import "./reset.css";'], "a.css"), ["./reset.css"]);
});

// --- Vue ---------------------------------------------------------------------

test("Vue: the three blocks a file is made of, and what its script declares", () => {
  const lines = [
    "<template>",
    "</template>",
    '<script setup lang="ts">',
    'const props = defineProps<{ id: string }>()',
    "function reload() {",
    "</script>",
    "<style scoped>",
  ];

  assert.deepStrictEqual(namesOf(lines, "vue"), ["template", "script", "props", "reload", "style"]);
});

// --- the definition jump gets the same patterns ------------------------------

test("a name is found where its own language declares it", () => {
  assert.strictEqual(definesName("function M.setup(opts)", "M.setup", "lua"), true);
  assert.strictEqual(definesName("func greet(name: String) {", "greet", "swift"), true);
  assert.strictEqual(definesName("fun load(id: String) {", "load", "kotlin"), true);
  assert.strictEqual(definesName("final class User extends Model", "User", "php"), true);
  assert.strictEqual(definesName("public sealed class OrderService", "OrderService", "csharp"), true);
});

test("a call is not a declaration in any of them", () => {
  assert.strictEqual(definesName("  M.setup(opts)", "M.setup", "lua"), false);
  assert.strictEqual(definesName("    greet(name: name)", "greet", "swift"), false);
  assert.strictEqual(definesName("    load(id)", "load", "kotlin"), false);
});

test("C#: the class inside a braced namespace, and its constructor", () => {
  // Regression: the type pattern was anchored at the margin, and C# has written
  // `namespace X { ... }` — which indents everything below it — for twenty years.
  const lines = [
    "namespace TominagaOrderSystem",
    "{",
    "    public partial class FormPreOrder : Form",
    "    {",
    "        public FormPreOrder()",
    "        private void btnBack_Click(object sender, EventArgs e)",
  ];

  assert.deepStrictEqual(namesOf(lines, "csharp"), [
    "TominagaOrderSystem",
    "FormPreOrder",
    "FormPreOrder",
    "btnBack_Click",
  ]);
});

test("C#: an indented control statement is still not a member", () => {
  assert.deepStrictEqual(namesOf(["        if (ready)", "        while (true)"], "csharp"), []);
});
