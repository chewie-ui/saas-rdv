const forgotPwdSendCode = document.getElementById("forgotPwdSendCode");
const forgotPwdEmail = document.getElementById("forgotPwdEmail");

if (forgotPwdSendCode && forgotPwdEmail) {
  forgotPwdSendCode.onclick = async function () {
    const value = forgotPwdEmail.value;
    const response = await fetch(`/forgot-password/verify-code`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        value,
      }),
    });

    const data = await reponse.json();

    if (data.success) {
        
    }
  };
}
