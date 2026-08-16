#!/usr/bin/env node
import React from "react";
import { render } from "ink";
import { loadHaaiDotenv } from "@haai/core/config";
import { resolveDefaultProxyUrl } from "@haai/core/http";
import { Dashboard } from "./components/Dashboard.js";

loadHaaiDotenv();
const baseUrl = await resolveDefaultProxyUrl();

render(React.createElement(Dashboard, { baseUrl }));
