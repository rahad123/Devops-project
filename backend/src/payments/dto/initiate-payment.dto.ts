import { IsArray, IsString, IsUUID, ArrayMinSize, ArrayMaxSize } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class InitiatePaymentDto {
  @ApiProperty({ description: 'Schedule to book' })
  @IsUUID()
  scheduleId: string;

  @ApiProperty({ example: ['1A', '1B'], description: 'Seat numbers currently held by the requesting user' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(6)
  @IsString({ each: true })
  seatNumbers: string[];

  @ApiProperty({ description: 'Boarding point for this schedule' })
  @IsUUID()
  boardingPointId: string;

  @ApiProperty({ description: 'Dropping point for this schedule' })
  @IsUUID()
  droppingPointId: string;
}
