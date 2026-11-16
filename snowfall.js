import { Snowfall } from "./assets/vendor/falling-snow/index.js";

const winterPage = document.body.classList.contains("winter-edition");

if (winterPage) {
  new Snowfall({ count: 80, zIndex: 0 });
}
