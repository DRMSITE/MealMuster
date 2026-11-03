// Runs the SonarQube scan. The token is read from SONAR_TOKEN and never printed.
import { scan } from "@sonar/scan";

if (!process.env.SONAR_TOKEN) {
  console.error("SONAR_TOKEN is not set.");
  process.exit(1);
}

await scan({
  serverUrl: "http://localhost:9000",
  token: process.env.SONAR_TOKEN,
  options: {},
});
