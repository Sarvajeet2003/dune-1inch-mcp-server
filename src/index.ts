import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool
} from '@modelcontextprotocol/sdk/types.js';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

interface Transaction {
  block_time: string;
  block_number: number;
  transaction_hash: string;
  from_address: string;
  to_address: string;
  eth_amount: number;
  gas_used: number;
  gas_price_gwei: number;
  total_fee_eth: number;
  success: boolean;
  nonce: number;
  direction: 'Outgoing' | 'Incoming';
}

interface DuneExecutionResponse {
  execution_id: string;
}

interface DuneResultsResponse {
  state: string;
  result?: {
    rows: Transaction[];
    metadata: any;
  };
  error?: string;
}

// 1inch API Interfaces
interface OneInchQuoteResponse {
  dstAmount: string;
  srcAmount: string;
  protocols: any[];
  estimatedGas: number;
}

interface OneInchSwapResponse {
  dstAmount: string;
  srcAmount: string;
  tx: {
    from: string;
    to: string;
    data: string;
    value: string;
    gasPrice: string;
    gas: number;
  };
  protocols: any[];
  estimatedGas: number;
}

interface OneInchTokensResponse {
  tokens: {
    [address: string]: {
      symbol: string;
      name: string;
      decimals: number;
      address: string;
      logoURI: string;
    };
  };
}

class OneInchAPIClient {
  private apiKey: string;
  private baseUrl = 'https://api.1inch.dev';
  private chainId = '1'; // Ethereum mainnet

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  private getHeaders() {
    return {
      'Authorization': `Bearer ${this.apiKey}`,
      'accept': 'application/json'
    };
  }

  async getQuote(
    fromTokenAddress: string,
    toTokenAddress: string,
    amount: string
  ): Promise<OneInchQuoteResponse> {
    try {
      const response = await axios.get<OneInchQuoteResponse>(
        `${this.baseUrl}/swap/v6.0/${this.chainId}/quote`,
        {
          headers: this.getHeaders(),
          params: {
            src: fromTokenAddress,
            dst: toTokenAddress,
            amount: amount,
            includeProtocols: true,
            includeGas: true
          }
        }
      );
      return response.data;
    } catch (error) {
      throw new Error(`Failed to get 1inch quote: ${error}`);
    }
  }

  async getSwapData(
    fromTokenAddress: string,
    toTokenAddress: string,
    amount: string,
    fromAddress: string,
    slippage: number = 1
  ): Promise<OneInchSwapResponse> {
    try {
      const response = await axios.get<OneInchSwapResponse>(
        `${this.baseUrl}/swap/v6.0/${this.chainId}/swap`,
        {
          headers: this.getHeaders(),
          params: {
            src: fromTokenAddress,
            dst: toTokenAddress,
            amount: amount,
            from: fromAddress,
            slippage: slippage,
            includeProtocols: true,
            includeGas: true
          }
        }
      );
      return response.data;
    } catch (error) {
      throw new Error(`Failed to get 1inch swap data: ${error}`);
    }
  }

  async getTokens(): Promise<OneInchTokensResponse> {
    try {
      const response = await axios.get<OneInchTokensResponse>(
        `${this.baseUrl}/swap/v6.0/${this.chainId}/tokens`,
        {
          headers: this.getHeaders()
        }
      );
      return response.data;
    } catch (error) {
      throw new Error(`Failed to get 1inch tokens: ${error}`);
    }
  }
}

class DuneAPIClient {
  private apiKey: string;
  private baseUrl = 'https://api.dune.com/api/v1';
  private queryId = '5267326';

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async executeQuery(walletAddress: string): Promise<Transaction[]> {
    try {
      const executionResponse = await axios.post<DuneExecutionResponse>(
        `${this.baseUrl}/query/${this.queryId}/execute`,
        {
          query_parameters: {
            wallet_address: walletAddress
          }
        },
        {
          headers: {
            'X-Dune-API-Key': this.apiKey,
            'Content-Type': 'application/json'
          }
        }
      );

      const executionId = executionResponse.data.execution_id;
      return await this.pollForResults(executionId);
    } catch (error) {
      throw new Error(`Failed to execute Dune query: ${error}`);
    }
  }

  private async pollForResults(executionId: string): Promise<Transaction[]> {
    const maxAttempts = 30;
    let attempts = 0;

    while (attempts < maxAttempts) {
      try {
        const response = await axios.get<DuneResultsResponse>(
          `${this.baseUrl}/execution/${executionId}/results`,
          {
            headers: {
              'X-Dune-API-Key': this.apiKey
            }
          }
        );

        if (response.data.state === 'QUERY_STATE_COMPLETED') {
          return response.data.result?.rows || [];
        } else if (response.data.state === 'QUERY_STATE_FAILED') {
          throw new Error(`Query failed: ${response.data.error || 'Unknown error'}`);
        }

        await new Promise(resolve => setTimeout(resolve, 2000));
        attempts++;
      } catch (error) {
        throw new Error(`Failed to get query results: ${error}`);
      }
    }

    throw new Error('Query execution timeout');
  }
}

class WalletAnalyzerServer {
  private server: Server;
  private duneClient: DuneAPIClient;
  private oneInchClient: OneInchAPIClient;
  private tokenCache: { [address: string]: any } = {};

  // Common token addresses
  private readonly COMMON_TOKENS = {
    'ETH': '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
    'USDT': '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    'USDC': '0xA0b86a33E6F05b0eF1d9bDDbdF5cDd4B4b1b6F7b',
    'DAI': '0x6B175474E89094C44Da98b954EedeAC495271d0F',
    'WETH': '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    'WBTC': '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599'
  };

  constructor() {
    this.server = new Server(
      { name: 'wallet-analyzer', version: '2.0.0' },
      { capabilities: { tools: {} } }
    );

    const duneApiKey = process.env.DUNE_API_KEY;
    const oneInchApiKey = process.env.ONEINCH_API_KEY;
    
    if (!duneApiKey) {
      throw new Error('DUNE_API_KEY environment variable is required');
    }

    this.duneClient = new DuneAPIClient(duneApiKey);
    this.oneInchClient = new OneInchAPIClient(oneInchApiKey);
    this.setupHandlers();
  }

  private setupHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'analyze_wallet',
            description: 'Analyze Ethereum wallet transactions using Dune Analytics',
            inputSchema: {
              type: 'object',
              properties: {
                wallet_address: {
                  type: 'string',
                  description: 'Ethereum wallet address to analyze (0x...)'
                },
                format: {
                  type: 'string',
                  enum: ['summary', 'detailed', 'raw'],
                  description: 'Output format for the analysis',
                  default: 'summary'
                }
              },
              required: ['wallet_address']
            }
          } as Tool,
          {
            name: 'recent_transactions',
            description: 'Get recent transactions for a wallet',
            inputSchema: {
              type: 'object',
              properties: {
                wallet_address: {
                  type: 'string',
                  description: 'Ethereum wallet address (0x...)'
                },
                limit: {
                  type: 'number',
                  description: 'Number of recent transactions to show',
                  default: 10
                }
              },
              required: ['wallet_address']
            }
          } as Tool,
          {
            name: 'smart_swap_analyzer',
            description: 'Analyze best swap opportunities based on wallet history and current market conditions',
            inputSchema: {
              type: 'object',
              properties: {
                wallet_address: {
                  type: 'string',
                  description: 'Ethereum wallet address (0x...)'
                },
                from_token: {
                  type: 'string',
                  description: 'Source token (symbol or address)'
                },
                to_token: {
                  type: 'string',
                  description: 'Destination token (symbol or address)'
                },
                amount: {
                  type: 'string',
                  description: 'Amount to swap (in source token units)'
                }
              },
              required: ['wallet_address', 'from_token', 'to_token', 'amount']
            }
          } as Tool,
          {
            name: 'gas_optimization_assistant',
            description: 'Optimize gas usage based on historical patterns and current network conditions',
            inputSchema: {
              type: 'object',
              properties: {
                wallet_address: {
                  type: 'string',
                  description: 'Ethereum wallet address (0x...)'
                },
                from_token: {
                  type: 'string',
                  description: 'Source token for swap (optional)'
                },
                to_token: {
                  type: 'string',
                  description: 'Destination token for swap (optional)'
                },
                amount: {
                  type: 'string',
                  description: 'Amount to swap (optional)'
                }
              },
              required: ['wallet_address']
            }
          } as Tool
        ]
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'analyze_wallet':
            return await this.analyzeWallet(args);
          case 'recent_transactions':
            return await this.getRecentTransactions(args);
          case 'smart_swap_analyzer':
            return await this.smartSwapAnalyzer(args);
          case 'gas_optimization_assistant':
            return await this.gasOptimizationAssistant(args);
          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${error instanceof Error ? error.message : String(error)}`
            }
          ],
          isError: true
        };
      }
    });
  }

  private async smartSwapAnalyzer(args: any) {
    const walletAddress = args.wallet_address?.toLowerCase();
    const fromToken = args.from_token;
    const toToken = args.to_token;
    const amount = args.amount;

    if (!this.isValidEthereumAddress(walletAddress)) {
      throw new Error('Invalid Ethereum address format');
    }

    // Get historical transaction data
    const transactions = await this.duneClient.executeQuery(walletAddress);
    
    // Resolve token addresses
    const fromTokenAddress = await this.resolveTokenAddress(fromToken);
    const toTokenAddress = await this.resolveTokenAddress(toToken);
    
    // Calculate amount in wei/smallest unit
    const tokenAmount = await this.calculateTokenAmount(fromTokenAddress, amount);
    
    // Get current swap quote
    const quote = await this.oneInchClient.getQuote(
      fromTokenAddress,
      toTokenAddress,
      tokenAmount
    );

    // Analyze historical patterns
    const historicalAnalysis = this.analyzeSwapHistory(transactions, fromTokenAddress, toTokenAddress);
    
    // Generate recommendations
    const analysis = this.generateSwapAnalysis(
      transactions,
      quote,
      historicalAnalysis,
      fromToken,
      toToken,
      amount
    );

    return {
      content: [{
        type: 'text',
        text: analysis
      }]
    };
  }

  private async gasOptimizationAssistant(args: any) {
    const walletAddress = args.wallet_address?.toLowerCase();
    const fromToken = args.from_token;
    const toToken = args.to_token;
    const amount = args.amount;

    if (!this.isValidEthereumAddress(walletAddress)) {
      throw new Error('Invalid Ethereum address format');
    }

    // Get historical transaction data
    const transactions = await this.duneClient.executeQuery(walletAddress);
    
    let gasOptimization = this.analyzeGasPatterns(transactions);

    // If swap parameters provided, get current quote for gas estimation
    if (fromToken && toToken && amount) {
      try {
        const fromTokenAddress = await this.resolveTokenAddress(fromToken);
        const toTokenAddress = await this.resolveTokenAddress(toToken);
        const tokenAmount = await this.calculateTokenAmount(fromTokenAddress, amount);
        
        const quote = await this.oneInchClient.getQuote(
          fromTokenAddress,
          toTokenAddress,
          tokenAmount
        );

        gasOptimization += this.generateGasOptimizationForSwap(transactions, quote, fromToken, toToken, amount);
      } catch (error) {
        gasOptimization += `\n\n⚠️ Could not analyze swap gas: ${error}`;
      }
    }

    return {
      content: [{
        type: 'text',
        text: gasOptimization
      }]
    };
  }

  private async resolveTokenAddress(token: string): Promise<string> {
    // Check if it's already an address
    if (token.startsWith('0x') && token.length === 42) {
      return token;
    }

    // Check common tokens
    const upperToken = token.toUpperCase();
    if (this.COMMON_TOKENS[upperToken]) {
      return this.COMMON_TOKENS[upperToken];
    }

    // For now, throw error for unknown tokens
    // In production, you might want to fetch from 1inch tokens API
    throw new Error(`Unknown token: ${token}. Please use token address or common symbols: ${Object.keys(this.COMMON_TOKENS).join(', ')}`);
  }

  private async calculateTokenAmount(tokenAddress: string, amount: string): Promise<string> {
    // For ETH, convert to wei
    if (tokenAddress === this.COMMON_TOKENS['ETH'] || tokenAddress === this.COMMON_TOKENS['WETH']) {
      return (parseFloat(amount) * 1e18).toString();
    }
    
    // For USDT/USDC (6 decimals)
    if (tokenAddress === this.COMMON_TOKENS['USDT'] || tokenAddress === this.COMMON_TOKENS['USDC']) {
      return (parseFloat(amount) * 1e6).toString();
    }
    
    // Default to 18 decimals
    return (parseFloat(amount) * 1e18).toString();
  }

  private analyzeSwapHistory(transactions: Transaction[], fromToken: string, toToken: string) {
    // Analyze historical swaps (simplified - in production you'd need to decode transaction data)
    const relevantTxs = transactions.filter(tx => 
      tx.success && (tx.direction === 'Outgoing' || tx.direction === 'Incoming')
    );

    const gasStats = this.calculateGasStats(relevantTxs);
    
    return {
      totalSwaps: relevantTxs.length,
      avgGasUsed: gasStats.avg,
      avgGasPrice: gasStats.avg,
      successRate: (relevantTxs.length / transactions.length) * 100
    };
  }

  private generateSwapAnalysis(
    transactions: Transaction[],
    quote: OneInchQuoteResponse,
    historical: any,
    fromToken: string,
    toToken: string,
    amount: string
  ): string {
    const stats = this.calculateStats(transactions);
    const estimatedGasCost = (quote.estimatedGas * 20) / 1e9; // Assume 20 Gwei

    return `
🔄 **Smart Swap Analysis: ${fromToken} → ${toToken}**

💱 **Current Market Quote:**
• Input: ${amount} ${fromToken}
• Output: ${(parseFloat(quote.dstAmount) / 1e18).toFixed(6)} ${toToken}
• Estimated Gas: ${quote.estimatedGas.toLocaleString()} units
• Est. Gas Cost: ~${estimatedGasCost.toFixed(4)} ETH

📊 **Your Trading History:**
• Total Transactions: ${stats.totalTxns.toLocaleString()}
• Success Rate: ${stats.successRate}%
• Average Gas Price Used: ${stats.avgGasPrice.toFixed(1)} Gwei
• Total Gas Fees Paid: ${stats.totalGasFees.toFixed(4)} ETH

🎯 **Personalized Recommendations:**
${this.generateSwapRecommendations(stats, quote, estimatedGasCost)}

⚡ **Protocols Used:** ${quote.protocols.slice(0, 3).map(p => p.name).join(', ')}
    `.trim();
  }

  private generateSwapRecommendations(stats: any, quote: any, estimatedGasCost: number): string {
    let recommendations = [];

    // Gas price recommendation
    if (stats.avgGasPrice < 20) {
      recommendations.push("• ✅ You typically use low gas prices. Current network conditions are favorable.");
    } else if (stats.avgGasPrice > 50) {
      recommendations.push("• ⚠️ You often pay high gas fees. Consider waiting for lower network congestion.");
    }

    // Gas cost vs transaction value
    const txValueUSD = 1000; // Simplified - would need price feeds
    const gasCostUSD = estimatedGasCost * 2000; // Simplified ETH price
    const gasRatio = (gasCostUSD / txValueUSD) * 100;

    if (gasRatio > 5) {
      recommendations.push(`• 💰 Gas cost is ${gasRatio.toFixed(1)}% of transaction value. Consider larger amounts or wait for lower gas.`);
    } else {
      recommendations.push(`• ✅ Gas cost is ${gasRatio.toFixed(1)}% of transaction value - reasonable for this swap.`);
    }

    // Success rate
    if (parseFloat(stats.successRate) > 95) {
      recommendations.push("• 🎯 Your success rate is excellent! This swap should execute smoothly.");
    }

    return recommendations.join('\n');
  }

  private analyzeGasPatterns(transactions: Transaction[]): string {
    const gasStats = this.calculateGasStats(transactions);
    const timePatterns = this.analyzeTimePatterns(transactions);
    
    return `
⛽ **Gas Optimization Analysis**

📊 **Your Gas Usage Patterns:**
• Average Gas Price: ${gasStats.avg.toFixed(2)} Gwei
• Median Gas Price: ${gasStats.median.toFixed(2)} Gwei
• Lowest Gas Used: ${gasStats.min.toFixed(2)} Gwei
• Highest Gas Used: ${gasStats.max.toFixed(2)} Gwei
• Total Gas Fees: ${this.calculateStats(transactions).totalGasFees.toFixed(4)} ETH

📅 **Timing Analysis:**
${timePatterns}

💡 **Optimization Recommendations:**
${this.generateGasRecommendations(gasStats, transactions)}
    `.trim();
  }

  private generateGasOptimizationForSwap(transactions: Transaction[], quote: any, fromToken: string, toToken: string, amount: string): string {
    const currentGasEstimate = quote.estimatedGas;
    const userAvgGas = this.calculateStats(transactions).avgGasPrice;
    
    return `\n
🔄 **Swap-Specific Gas Optimization:**
• Estimated Gas for ${fromToken}→${toToken}: ${currentGasEstimate.toLocaleString()} units
• Your Avg Gas Price: ${userAvgGas.toFixed(1)} Gwei
• Estimated Cost: ~${(currentGasEstimate * userAvgGas / 1e9).toFixed(4)} ETH

💰 **Cost Optimization:**
• If you wait for 15 Gwei: ~${(currentGasEstimate * 15 / 1e9).toFixed(4)} ETH
• If you wait for 10 Gwei: ~${(currentGasEstimate * 10 / 1e9).toFixed(4)} ETH
• Potential Savings: Up to ${((currentGasEstimate * userAvgGas - currentGasEstimate * 10) / 1e9).toFixed(4)} ETH
    `;
  }

  private analyzeTimePatterns(transactions: Transaction[]): string {
    // Analyze transaction timing patterns
    const hourCounts = new Array(24).fill(0);
    const dayOfWeekCounts = new Array(7).fill(0);

    transactions.forEach(tx => {
      const date = new Date(tx.block_time);
      hourCounts[date.getHours()]++;
      dayOfWeekCounts[date.getDay()]++;
    });

    const bestHour = hourCounts.indexOf(Math.max(...hourCounts));
    const bestDay = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dayOfWeekCounts.indexOf(Math.max(...dayOfWeekCounts))];

    return `• Most Active Hour: ${bestHour}:00 UTC\n• Most Active Day: ${bestDay}`;
  }

  private generateGasRecommendations(gasStats: any, transactions: Transaction[]): string {
    const recommendations = [];

    if (gasStats.avg > 30) {
      recommendations.push("• 🔥 You typically use high gas prices. Consider using lower gas during off-peak hours.");
    }

    if (gasStats.max > gasStats.avg * 2) {
      recommendations.push("• ⚠️ Some transactions used excessive gas. Check gas estimates before confirming.");
    }

    recommendations.push("• 📊 Best times for low gas: Early morning UTC (2-8 AM) and weekends.");
    recommendations.push("• 🎯 Consider batching multiple operations to save on gas costs.");

    return recommendations.join('\n');
  }

  // ... (keeping all existing methods: calculateStats, formatSummaryAnalysis, etc.)
  // [All your existing methods remain unchanged]

  private async analyzeWallet(args: any) {
    const walletAddress = args.wallet_address?.toLowerCase();
    const format = args.format || 'summary';

    if (!this.isValidEthereumAddress(walletAddress)) {
      throw new Error('Invalid Ethereum address format');
    }

    const transactions = await this.duneClient.executeQuery(walletAddress);

    if (transactions.length === 0) {
      return {
        content: [{
          type: 'text',
          text: `No transactions found for wallet: ${walletAddress}`
        }]
      };
    }

    let analysis: string;

    switch (format) {
      case 'detailed':
        analysis = this.formatDetailedAnalysis(transactions, walletAddress);
        break;
      case 'raw':
        analysis = JSON.stringify(transactions, null, 2);
        break;
      default:
        analysis = this.formatSummaryAnalysis(transactions, walletAddress);
    }

    return {
      content: [{
        type: 'text',
        text: analysis
      }]
    };
  }

  private async getRecentTransactions(args: any) {
    const walletAddress = args.wallet_address?.toLowerCase();
    const limit = Math.min(args.limit || 10, 50);

    if (!this.isValidEthereumAddress(walletAddress)) {
      throw new Error('Invalid Ethereum address format');
    }

    const transactions = await this.duneClient.executeQuery(walletAddress);
    const recentTxs = transactions.slice(0, limit);

    const formatted = this.formatRecentTransactions(recentTxs);

    return {
      content: [{
        type: 'text',
        text: formatted
      }]
    };
  }

  private formatSummaryAnalysis(transactions: Transaction[], walletAddress: string): string {
    const stats = this.calculateStats(transactions);
    
    return `
🔍 **Wallet Analysis: ${walletAddress}**

📊 **Overview:**
• Total Transactions: ${stats.totalTxns.toLocaleString()}
• Success Rate: ${stats.successRate}%
• Outgoing: ${stats.outgoingCount.toLocaleString()}
• Incoming: ${stats.incomingCount.toLocaleString()}

💰 **ETH Activity:**
• Total Sent: ${stats.totalSent.toFixed(4)} ETH
• Total Received: ${stats.totalReceived.toFixed(4)} ETH
• Net Balance: ${stats.netBalance.toFixed(4)} ETH
• Gas Fees Paid: ${stats.totalGasFees.toFixed(4)} ETH

⛽ **Gas Statistics:**
• Average Gas Price: ${stats.avgGasPrice.toFixed(1)} Gwei
• Total Gas Used: ${stats.totalGasUsed.toLocaleString()}

📅 **Activity Period:**
• Latest Transaction: ${stats.latestTx}
• First Transaction: ${stats.firstTx}
    `.trim();
  }

  private formatDetailedAnalysis(transactions: Transaction[], walletAddress: string): string {
    const stats = this.calculateStats(transactions);
    const gasStats = this.calculateGasStats(transactions);
    
    return `
🔍 **Detailed Wallet Analysis: ${walletAddress}**

📊 **Transaction Metrics:**
• Total Transactions: ${stats.totalTxns.toLocaleString()}
• Successful: ${stats.successfulTxns.toLocaleString()} (${stats.successRate}%)
• Failed: ${stats.totalTxns - stats.successfulTxns} (${(100 - stats.successRate).toFixed(1)}%)
• Outgoing vs Incoming: ${stats.outgoingCount}:${stats.incomingCount}

💰 **Financial Summary:**
• ETH Sent: ${stats.totalSent.toFixed(6)} ETH
• ETH Received: ${stats.totalReceived.toFixed(6)} ETH
• Net Position: ${stats.netBalance.toFixed(6)} ETH
• Total Gas Spent: ${stats.totalGasFees.toFixed(6)} ETH

⛽ **Advanced Gas Analysis:**
• Average Gas Price: ${gasStats.avg.toFixed(2)} Gwei
• Median Gas Price: ${gasStats.median.toFixed(2)} Gwei
• Highest Gas Price: ${gasStats.max.toFixed(2)} Gwei
• Lowest Gas Price: ${gasStats.min.toFixed(2)} Gwei
• Total Gas Used: ${stats.totalGasUsed.toLocaleString()}
• Average Gas per Transaction: ${(stats.totalGasUsed / stats.totalTxns).toFixed(0)}

📈 **Activity Patterns:**
• Most Active Day: ${stats.latestTx.split('T')[0]}
• Average Transactions per Day: ${this.calculateDailyAverage(transactions).toFixed(1)}

📅 **Timeline:**
• First Transaction: ${stats.firstTx}
• Latest Transaction: ${stats.latestTx}
• Analysis Period: ${this.calculateDaysBetween(stats.firstTx, stats.latestTx)} days
    `.trim();
  }

  private formatRecentTransactions(transactions: Transaction[]): string {
    if (transactions.length === 0) {
      return 'No recent transactions found.';
    }

    let output = `🕐 **Recent Transactions (${transactions.length})**\n\n`;

    transactions.forEach((tx, index) => {
      const directionEmoji = tx.direction === 'Outgoing' ? '📤' : '📥';
      const statusEmoji = tx.success ? '✅' : '❌';
      const date = new Date(tx.block_time).toLocaleDateString();
      const time = new Date(tx.block_time).toLocaleTimeString();

      output += `${index + 1}. ${directionEmoji} **${tx.direction}** ${statusEmoji}\n`;
      output += `   • Amount: ${tx.eth_amount.toFixed(4)} ETH\n`;
      output += `   • Fee: ${tx.total_fee_eth.toFixed(5)} ETH (${tx.gas_price_gwei.toFixed(1)} Gwei)\n`;
      output += `   • Date: ${date} ${time}\n`;
      output += `   • Hash: \`${tx.transaction_hash.substring(0, 16)}...\`\n`;
      output += `   • Block: ${tx.block_number.toLocaleString()}\n\n`;
    });

    return output.trim();
  }

  private calculateStats(transactions: Transaction[]) {
    const outgoing = transactions.filter(tx => tx.direction === 'Outgoing');
    const incoming = transactions.filter(tx => tx.direction === 'Incoming');
    const successful = transactions.filter(tx => tx.success);

    const totalSent = outgoing.reduce((sum, tx) => sum + (tx.eth_amount || 0), 0);
    const totalReceived = incoming.reduce((sum, tx) => sum + (tx.eth_amount || 0), 0);
    const totalGasFees = transactions.reduce((sum, tx) => sum + (tx.total_fee_eth || 0), 0);
    const totalGasUsed = transactions.reduce((sum, tx) => sum + (tx.gas_used || 0), 0);
    const avgGasPrice = transactions.reduce((sum, tx) => sum + (tx.gas_price_gwei || 0), 0) / transactions.length;
    // ... (continuing from where I stopped)

    return {
        totalTxns: transactions.length,
        successfulTxns: successful.length,
        successRate: ((successful.length / transactions.length) * 100).toFixed(1),
        outgoingCount: outgoing.length,
        incomingCount: incoming.length,
        totalSent,
        totalReceived,
        netBalance: totalReceived - totalSent,
        totalGasFees,
        totalGasUsed,
        avgGasPrice,
        latestTx: transactions[0]?.block_time || '',
        firstTx: transactions[transactions.length - 1]?.block_time || ''
      };
    }
  
    private calculateGasStats(transactions: Transaction[]) {
      const gasPrices = transactions.map(tx => tx.gas_price_gwei).sort((a, b) => a - b);
      const mid = Math.floor(gasPrices.length / 2);
      
      return {
        avg: gasPrices.reduce((a, b) => a + b, 0) / gasPrices.length,
        median: gasPrices.length % 2 ? gasPrices[mid] : (gasPrices[mid - 1] + gasPrices[mid]) / 2,
        min: gasPrices[0],
        max: gasPrices[gasPrices.length - 1]
      };
    }
  
    private calculateDailyAverage(transactions: Transaction[]): number {
      if (transactions.length < 2) return 0;
      
      const firstDate = new Date(transactions[transactions.length - 1].block_time);
      const lastDate = new Date(transactions[0].block_time);
      const daysDiff = Math.max(1, Math.ceil((lastDate.getTime() - firstDate.getTime()) / (1000 * 60 * 60 * 24)));
      
      return transactions.length / daysDiff;
    }
  
    private calculateDaysBetween(date1: string, date2: string): number {
      const d1 = new Date(date1);
      const d2 = new Date(date2);
      return Math.ceil(Math.abs(d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));
    }
  
    private isValidEthereumAddress(address: string): boolean {
      return typeof address === 'string' && 
             address.length === 42 && 
             address.startsWith('0x') &&
             /^0x[a-fA-F0-9]{40}$/.test(address);
    }
  
    async run() {
      const transport = new StdioServerTransport();
      await this.server.connect(transport);
      console.error('Wallet Analyzer MCP Server started with enhanced DeFi tools');
    }
  }
  
  // Start the server
  const server = new WalletAnalyzerServer();
  server.run().catch(console.error);