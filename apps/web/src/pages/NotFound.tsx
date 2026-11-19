import { Compass, ShieldOff } from 'lucide-react';
import { Link } from 'react-router';
import { EmptyState } from '@/components/common';
import { Button } from '@/components/ui/button';
import { usePageTitle } from '@/lib/theme';

export function NotFoundPage({ forbidden }: { forbidden?: boolean }) {
  usePageTitle(forbidden ? 'Restricted' : 'Not found');
  return (
    <EmptyState
      className="py-24"
      icon={forbidden ? <ShieldOff /> : <Compass />}
      title={forbidden ? 'Admins only' : 'This page has been delisted'}
      action={
        <Button variant="secondary" asChild>
          <Link to="/markets">Back to the markets</Link>
        </Button>
      }
    >
      {forbidden
        ? 'This area requires an administrator account. Every admin action is audited.'
        : 'We couldn’t find that page. It may have never IPO’d.'}
    </EmptyState>
  );
}
