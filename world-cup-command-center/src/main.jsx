import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.jsx";
import "./styles.css";

class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error) {
    console.error("Dashboard render failed", error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <main className="app-error-shell">
          <section className="app-error-card">
            <p>页面渲染异常</p>
            <h1>当前比赛数据不完整，已停止渲染详情页。</h1>
            <button type="button" onClick={() => window.location.reload()}>
              刷新页面
            </button>
          </section>
        </main>
      );
    }

    return this.props.children;
  }
}

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </React.StrictMode>,
);
