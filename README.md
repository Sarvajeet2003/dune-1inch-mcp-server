# `eth-wallet-mcp-server`  
**Ethereum Wallet Analysis + DeFi Insights via MCP Protocol** 🚀  
Integrates [Dune Analytics](https://dune.com) and [1inch API](https://api.1inch.dev) for transaction tracking, smart swaps, and gas optimization. Built with the [Model Context Protocol](https://modelcontextprotocol.org/) for AI-agent-ready blockchain data integration.

---

## 🔍 Features  
- **Ethereum Wallet Analysis**:  
  - Transaction history, balances, and gas usage patterns via Dune Analytics.  
  - Tools: `analyze_wallet`, `recent_transactions`.  

- **DeFi Tools**:  
  - Swap analysis (via [1inch API](https://api.1inch.dev)) for optimal token exchanges.  
  - Gas cost estimation for DeFi interactions (e.g., swaps, liquidity provision).  
  - Tool: `smart_swap_analyzer`.  

- **Gas Optimization**:  
  - Historical gas pattern analysis and real-time recommendations.  
  - Tool: `gas_optimization_assistant`.  

- **API Integrations**:  
  - [Dune Analytics](https://dune.com) for on-chain data aggregation.  
  - [1inch Dev API](https://api.1inch.dev) for DeFi swap execution.  

---

## 📦 Installation  
1. **Prerequisites**:  
   - Node.js 18+  
   - npm or yarn  

2. **Install Dependencies**:  
   ```bash
   npm install
   # or
   yarn install
   ```

3. **Set Environment Variables**:  
   Create a `.env` file with:  
   ```env
   DUNE_API_KEY=your_dune_api_key
   ONEINCH_API_KEY=your_1inch_api_key  # Optional (default: UYKu6XN4oXeRzHCB50GpTpaopYhAprTP)
   ```

4. **Run the Server**:  
   ```bash
   npm start
   # or
   node dist/index.js
   ```

---

## 🛠️ Usage  
### Tools Available  
1. **`analyze_wallet`**:  
   Analyze wallet transactions (summary/detailed/raw formats).  
   ```json
   {
     "name": "analyze_wallet",
     "arguments": {
       "wallet_address": "0x...",
       "format": "summary"
     }
   }
   ```

2. **`recent_transactions`**:  
   Get recent transactions for a wallet.  
   ```json
   {
     "name": "recent_transactions",
     "arguments": {
       "wallet_address": "0x...",
       "limit": 10
     }
   }
   ```

3. **`smart_swap_analyzer`**:  
   Optimize token swaps based on wallet history and market conditions.  
   ```json
   {
     "name": "smart_swap_analyzer",
     "arguments": {
       "wallet_address": "0x...",
       "from_token": "ETH",
       "to_token": "DAI",
       "amount": "0.5"
     }
   }
   ```

4. **`gas_optimization_assistant`**:  
   Optimize gas usage for transactions/swaps.  
   ```json
   {
     "name": "gas_optimization_assistant",
     "arguments": {
       "wallet_address": "0x..."
     }
   }
   ```

---

## 🌐 API Keys  
- **Dune Analytics**:  
  - Get your API key from [Dune Settings](https://dune.com/settings).  
- **1inch API**:  
  - Register at [1inch Developer Portal](https://api.1inch.dev) for a free key.  

---

## 🧪 Example Output  
```text
🔄 Smart Swap Analysis: ETH → DAI  
• Input: 0.5 ETH  
• Output: 0.784 DAI  
• Estimated Gas: 150,000 units  
• Gas Cost: ~0.003 ETH  

📊 Your Trading History:  
• Total Transactions: 120  
• Success Rate: 98%  
• Avg Gas Price: 22 Gwei  

💡 Recommendations:  
• Gas cost is 0.6% of transaction value – reasonable.  
• Most active hour: 3:00 UTC (low gas prices expected).
```

---

## 🤝 Contributing  
1. Fork the repository.  
2. Create a feature branch (`git checkout -b feature/new-tool`).  
3. Commit changes (`git commit -am 'Add new tool'`).  
4. Push to the branch (`git push origin feature/new-tool`).  
5. Open a pull request.  

---

## 📄 License  
MIT License – see `LICENSE` for details.  

---

### 🚀 Built With  
- [Model Context Protocol SDK](https://modelcontextprotocol.org/)  
- [Axios](https://axios-http.com) for HTTP requests  
- [Dune Analytics](https://dune.com)  
- [1inch API](https://api.1inch.dev)  

---

### 📬 Questions?  
Contact [your_email] or open an issue on GitHub.  

---

**Star ⭐ if you found this useful!**  

--- 

This README follows GitHub’s [best practices](https://docs.github.com/en/collections/010-getting-started-with-github/030-what-is-a-readme) (https://docs.github.com/en/collections/010-getting-started-with-github/030-what-is-a-readme) and includes code-specific details like tool examples and API key setup. Let me know if you need adjustments!
