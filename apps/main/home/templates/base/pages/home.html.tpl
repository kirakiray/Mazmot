<template page>
  <style>
    :host {
      display: block;
      height: 100%;
    }
    .welcome {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100%;
      padding: 20px;
      text-align: center;
    }
    h1 {
      color: var(--md-sys-color-primary);
      margin-bottom: 12px;
    }
    p {
      color: var(--md-sys-color-on-surface-variant);
      line-height: 1.6;
    }
  </style>
  <div class="welcome">
    <h1>Hello, {{APP_NAME}}!</h1>
    <p>{{APP_DESC_HTML}}</p>
  </div>
  <script>
    export default async () => {
      return {
        data: {},
      };
    };
  </script>
</template>
