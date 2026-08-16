#!/usr/bin/env node
import React from "react";
import { render } from "ink";
import { Dashboard } from "./components/Dashboard.js";

const baseUrl = process.env["HAAI_URL"] ?? "http://localhost:4000";

render(React.createElement(Dashboard, { baseUrl }));
