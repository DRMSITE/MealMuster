// @ts-check
import "@awesome.me/webawesome/dist/styles/webawesome.css";
import "@awesome.me/webawesome/dist/components/button/button.js";
import "@awesome.me/webawesome/dist/components/callout/callout.js";
import "@awesome.me/webawesome/dist/components/card/card.js";
import "@awesome.me/webawesome/dist/components/checkbox/checkbox.js";
import "@awesome.me/webawesome/dist/components/input/input.js";
import "@awesome.me/webawesome/dist/components/radio/radio.js";
import "@awesome.me/webawesome/dist/components/radio-group/radio-group.js";
import "@awesome.me/webawesome/dist/components/textarea/textarea.js";
import "./styles.css";
import "./elements/mm-redeem.js";
import "./elements/mm-booking.js";
import "./elements/mm-admin.js";

const main = document.getElementById("main");
if (main) {
  // The only token-bearing URL is /i#<token>. The fragment is never sent to a server.
  const admin =
    location.pathname === "/admin" || location.pathname.startsWith("/admin/");
  if (admin) document.body.dataset.area = "admin";
  const tag = admin
    ? "mm-admin"
    : location.pathname === "/i"
      ? "mm-redeem"
      : "mm-booking";
  main.append(document.createElement(tag));
}
