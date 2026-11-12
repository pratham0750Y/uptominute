// Runs before the page paints so the saved theme shows with no flash. Loaded on every page.
(function () { try { var t = localStorage.getItem("blr-theme"); if (t) document.documentElement.setAttribute("data-theme", t); } catch (e) {} })();
