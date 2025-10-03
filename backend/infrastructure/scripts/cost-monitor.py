# scripts/cost-monitor.py (continued)
import boto3
import json
from datetime import datetime, timedelta
from decimal import Decimal

class CostMonitor:
    def __init__(self):
        self.ce_client = boto3.client('ce')
        self.sns_client = boto3.client('sns')
        self.budget_limit = 15.00  # Monthly budget limit
        
    def get_current_month_cost(self):
        """Get current month's cost"""
        start_date = datetime.now().replace(day=1).strftime('%Y-%m-%d')
        end_date = datetime.now().strftime('%Y-%m-%d')
        
        response = self.ce_client.get_cost_and_usage(
            TimePeriod={'Start': start_date, 'End': end_date},
            Granularity='MONTHLY',
            Metrics=['BlendedCost'],
            GroupBy=[{'Type': 'DIMENSION', 'Key': 'SERVICE'}]
        )
        
        total_cost = 0
        service_costs = {}
        
        for result in response['ResultsByTime']:
            for group in result['Groups']:
                service = group['Keys'][0]
                cost = float(group['Metrics']['BlendedCost']['Amount'])
                service_costs[service] = cost
                total_cost += cost
                
        return total_cost, service_costs
    
    def get_forecasted_cost(self):
        """Get forecasted monthly cost"""
        start_date = datetime.now().strftime('%Y-%m-%d')
        end_date = (datetime.now().replace(day=1) + timedelta(days=32)).replace(day=1).strftime('%Y-%m-%d')
        
        response = self.ce_client.get_cost_forecast(
            TimePeriod={'Start': start_date, 'End': end_date},
            Metric='BLENDED_COST',
            Granularity='MONTHLY'
        )
        
        return float(response['Total']['Amount'])
    
    def check_budget_alerts(self):
        """Check if costs exceed budget thresholds"""
        current_cost, service_costs = self.get_current_month_cost()
        forecasted_cost = self.get_forecasted_cost()
        
        alerts = []
        
        # Alert thresholds
        if current_cost > self.budget_limit * 0.8:  # 80% of budget
            alerts.append({
                'level': 'WARNING',
                'message': f'Current cost (${current_cost:.2f}) exceeds 80% of budget (${self.budget_limit})'
            })
        
        if current_cost > self.budget_limit:  # 100% of budget
            alerts.append({
                'level': 'CRITICAL',
                'message': f'Current cost (${current_cost:.2f}) exceeds budget limit (${self.budget_limit})'
            })
        
        if forecasted_cost > self.budget_limit * 1.2:  # Forecasted > 120% of budget
            alerts.append({
                'level': 'WARNING',
                'message': f'Forecasted cost (${forecasted_cost:.2f}) will exceed budget by 20%'
            })
        
        return alerts, current_cost, forecasted_cost, service_costs
    
    def generate_cost_report(self):
        """Generate detailed cost report"""
        alerts, current_cost, forecasted_cost, service_costs = self.check_budget_alerts()
        
        report = {
            'timestamp': datetime.now().isoformat(),
            'current_month_cost': current_cost,
            'forecasted_cost': forecasted_cost,
            'budget_limit': self.budget_limit,
            'budget_utilization': (current_cost / self.budget_limit) * 100,
            'service_breakdown': service_costs,
            'alerts': alerts,
            'top_cost_services': sorted(service_costs.items(), key=lambda x: x[1], reverse=True)[:5]
        }
        
        return report
    
    def send_alert(self, topic_arn, message):
        """Send SNS alert"""
        try:
            self.sns_client.publish(
                TopicArn=topic_arn,
                Message=message,
                Subject='Rideshare App - Cost Alert'
            )
            return True
        except Exception as e:
            print(f"Error sending alert: {e}")
            return False

if __name__ == "__main__":
    monitor = CostMonitor()
    report = monitor.generate_cost_report()
    
    print("=== RIDESHARE APP COST REPORT ===")
    print(f"Current Month Cost: ${report['current_month_cost']:.2f}")
    print(f"Forecasted Cost: ${report['forecasted_cost']:.2f}")
    print(f"Budget Utilization: {report['budget_utilization']:.1f}%")
    print(f"Budget Remaining: ${report['budget_limit'] - report['current_month_cost']:.2f}")
    
    print("\nTop Cost Services:")
    for service, cost in report['top_cost_services']:
        print(f"  {service}: ${cost:.2f}")
    
    if report['alerts']:
        print("\n  ALERTS:")
        for alert in report['alerts']:
            print(f"  [{alert['level']}] {alert['message']}")
    
    # Save report to file
    with open(f"cost-report-{datetime.now().strftime('%Y-%m-%d')}.json", 'w') as f:
        json.dump(report, f, indent=2)
